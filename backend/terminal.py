"""Web terminal: local PTY shell + remote SSH, plus server & command libraries."""
import asyncio
import fcntl
import io
import json
import os
import pty
import struct
import termios

import jwt
import paramiko
from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect

from deploy_engine import decrypt_token, encrypt_token
from models import (
    TerminalCommand,
    TerminalCommandCreate,
    TerminalCommandUpdate,
    TerminalServer,
    TerminalServerCreate,
    TerminalServerUpdate,
    now_iso,
    terminal_server_public,
)


def _set_winsize(fd: int, rows: int, cols: int):
    try:
        winsize = struct.pack("HHHH", max(rows, 1), max(cols, 1), 0, 0)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)
    except Exception:
        pass


# ------------------------------------------------------------- CRUD router ---
def build_terminal_router(db, get_current_user) -> APIRouter:
    router = APIRouter(prefix="/terminal")

    # ---- servers ----
    @router.get("/servers")
    async def list_servers(current=Depends(get_current_user)):
        items = []
        async for doc in db.terminal_servers.find().sort("created_at", -1):
            items.append(terminal_server_public(TerminalServer.from_mongo(doc)))
        return items

    @router.post("/servers")
    async def create_server(body: TerminalServerCreate, current=Depends(get_current_user)):
        server = TerminalServer(
            name=body.name,
            host=body.host,
            port=body.port or 22,
            username=body.username or "root",
            auth_type=body.auth_type or "password",
        )
        if body.password:
            server.password_enc = encrypt_token(body.password)
        if body.private_key:
            server.private_key_enc = encrypt_token(body.private_key)
        res = await db.terminal_servers.insert_one(server.to_mongo())
        server.id = str(res.inserted_id)
        return terminal_server_public(server)

    @router.put("/servers/{server_id}")
    async def update_server(server_id: str, body: TerminalServerUpdate, current=Depends(get_current_user)):
        update = body.model_dump(exclude_unset=True)
        if "password" in update:
            pw = update.pop("password")
            if pw:
                update["password_enc"] = encrypt_token(pw)
        if "private_key" in update:
            pk = update.pop("private_key")
            if pk:
                update["private_key_enc"] = encrypt_token(pk)
        if update:
            await db.terminal_servers.update_one({"_id": ObjectId(server_id)}, {"$set": update})
        doc = await db.terminal_servers.find_one({"_id": ObjectId(server_id)})
        if not doc:
            raise HTTPException(status_code=404, detail="Server not found")
        return terminal_server_public(TerminalServer.from_mongo(doc))

    @router.delete("/servers/{server_id}")
    async def delete_server(server_id: str, current=Depends(get_current_user)):
        await db.terminal_servers.delete_one({"_id": ObjectId(server_id)})
        return {"ok": True}

    # ---- commands ----
    @router.get("/commands")
    async def list_commands(current=Depends(get_current_user)):
        items = []
        async for doc in db.terminal_commands.find().sort("name", 1):
            items.append(TerminalCommand.from_mongo(doc).model_dump())
        return items

    @router.post("/commands")
    async def create_command(body: TerminalCommandCreate, current=Depends(get_current_user)):
        cmd = TerminalCommand(name=body.name, command=body.command)
        res = await db.terminal_commands.insert_one(cmd.to_mongo())
        cmd.id = str(res.inserted_id)
        return cmd.model_dump()

    @router.put("/commands/{command_id}")
    async def update_command(command_id: str, body: TerminalCommandUpdate, current=Depends(get_current_user)):
        update = body.model_dump(exclude_unset=True)
        if update:
            await db.terminal_commands.update_one({"_id": ObjectId(command_id)}, {"$set": update})
        doc = await db.terminal_commands.find_one({"_id": ObjectId(command_id)})
        if not doc:
            raise HTTPException(status_code=404, detail="Command not found")
        return TerminalCommand.from_mongo(doc).model_dump()

    @router.delete("/commands/{command_id}")
    async def delete_command(command_id: str, current=Depends(get_current_user)):
        await db.terminal_commands.delete_one({"_id": ObjectId(command_id)})
        return {"ok": True}

    return router


# ------------------------------------------------------- websocket sessions ---
def _ws_authed(websocket: WebSocket, get_jwt_secret) -> bool:
    token = websocket.query_params.get("token")
    try:
        jwt.decode(token, get_jwt_secret(), algorithms=["HS256"])
        return True
    except Exception:
        return False


async def local_terminal_session(websocket: WebSocket, get_jwt_secret):
    if not _ws_authed(websocket, get_jwt_secret):
        await websocket.close(code=1008)
        return
    await websocket.accept()

    pid, master_fd = pty.fork()
    if pid == 0:  # child
        os.environ["TERM"] = "xterm-256color"
        shell = os.environ.get("SHELL", "/bin/bash")
        os.execvp(shell, [shell])
        os._exit(1)

    loop = asyncio.get_event_loop()
    out_queue: asyncio.Queue = asyncio.Queue()

    def on_readable():
        try:
            data = os.read(master_fd, 65536)
        except OSError:
            data = b""
        out_queue.put_nowait(data or None)

    loop.add_reader(master_fd, on_readable)

    async def sender():
        while True:
            data = await out_queue.get()
            if data is None:
                break
            await websocket.send_bytes(data)

    async def receiver():
        while True:
            msg = await websocket.receive_text()
            try:
                obj = json.loads(msg)
            except ValueError:
                continue
            if obj.get("type") == "input":
                os.write(master_fd, obj.get("data", "").encode())
            elif obj.get("type") == "resize":
                _set_winsize(master_fd, int(obj.get("rows", 24)), int(obj.get("cols", 80)))

    try:
        await asyncio.gather(sender(), receiver())
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        try:
            loop.remove_reader(master_fd)
        except Exception:
            pass
        try:
            os.close(master_fd)
        except Exception:
            pass
        try:
            os.kill(pid, 9)
            os.waitpid(pid, 0)
        except Exception:
            pass


async def ssh_terminal_session(websocket: WebSocket, get_jwt_secret, db, server_id: str):
    if not _ws_authed(websocket, get_jwt_secret):
        await websocket.close(code=1008)
        return
    await websocket.accept()

    try:
        doc = await db.terminal_servers.find_one({"_id": ObjectId(server_id)})
    except Exception:
        doc = None
    if not doc:
        await websocket.send_bytes(b"\r\n[panel] Server not found.\r\n")
        await websocket.close()
        return

    server = TerminalServer.from_mongo(doc)
    password = decrypt_token(server.password_enc) if server.password_enc else None
    private_key = decrypt_token(server.private_key_enc) if server.private_key_enc else None

    def connect():
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        kwargs = {
            "hostname": server.host,
            "port": server.port,
            "username": server.username,
            "timeout": 15,
            "allow_agent": False,
            "look_for_keys": False,
        }
        if server.auth_type == "key" and private_key:
            pkey = None
            for loader in (paramiko.RSAKey, paramiko.Ed25519Key, paramiko.ECDSAKey):
                try:
                    pkey = loader.from_private_key(io.StringIO(private_key))
                    break
                except Exception:
                    continue
            if pkey is None:
                raise ValueError("Unsupported or invalid private key")
            kwargs["pkey"] = pkey
        else:
            kwargs["password"] = password
        client.connect(**kwargs)
        chan = client.invoke_shell(term="xterm-256color")
        chan.settimeout(0.0)
        return client, chan

    try:
        client, chan = await asyncio.to_thread(connect)
    except Exception as e:
        await websocket.send_bytes(f"\r\n[panel] SSH connection failed: {e}\r\n".encode())
        await websocket.close()
        return

    await websocket.send_bytes(f"\r\n[panel] Connected to {server.username}@{server.host}:{server.port}\r\n".encode())
    stop = asyncio.Event()

    async def sender():
        while not stop.is_set():
            try:
                data = await asyncio.to_thread(_recv, chan)
            except Exception:
                break
            if data is None:
                break
            if data:
                await websocket.send_bytes(data)
            else:
                await asyncio.sleep(0.02)

    async def receiver():
        while True:
            msg = await websocket.receive_text()
            try:
                obj = json.loads(msg)
            except ValueError:
                continue
            if obj.get("type") == "input":
                chan.send(obj.get("data", ""))
            elif obj.get("type") == "resize":
                try:
                    chan.resize_pty(width=int(obj.get("cols", 80)), height=int(obj.get("rows", 24)))
                except Exception:
                    pass

    try:
        await asyncio.gather(sender(), receiver())
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        stop.set()
        try:
            chan.close()
        except Exception:
            pass
        try:
            client.close()
        except Exception:
            pass


def _recv(chan):
    """Blocking-ish recv used via to_thread; returns bytes, b'' if idle, None if closed."""
    import time

    if chan.closed or chan.exit_status_ready():
        return None
    if chan.recv_ready():
        return chan.recv(65536)
    time.sleep(0.02)
    return b""
