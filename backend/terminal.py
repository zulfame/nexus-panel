"""Web terminal: local PTY shell + remote SSH, plus server & command libraries."""
import asyncio
import fcntl
import io
import json
import os
import pty
import struct
import termios
import time as _time
from datetime import datetime, timezone

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


# ---------------------------------------------------- session recording ------
MAX_RECORDINGS = int(os.environ.get("TERMINAL_MAX_RECORDINGS", "50"))
REC_MAX_BYTES = int(os.environ.get("TERMINAL_REC_MAX_BYTES", "2000000"))


class TerminalRecorder:
    """Asciinema-style output recorder: captures terminal output with time offsets."""

    def __init__(self, db, kind: str, title: str):
        self.db = db
        self.kind = kind
        self.title = title
        self.events: list = []
        self.bytes = 0
        self.truncated = False
        self._start = _time.monotonic()
        self.started_at = datetime.now(timezone.utc)

    def record(self, data: bytes):
        if self.truncated or not data:
            return
        if self.bytes + len(data) > REC_MAX_BYTES:
            self.truncated = True
            self.events.append([round(_time.monotonic() - self._start, 3),
                                "\r\n\x1b[33m[panel] — recording truncated (size limit) —\x1b[0m\r\n"])
            return
        self.bytes += len(data)
        self.events.append([round(_time.monotonic() - self._start, 3),
                            data.decode("utf-8", "replace")])

    async def save(self):
        if not self.events:
            return
        try:
            ended = datetime.now(timezone.utc)
            await self.db.terminal_recordings.insert_one({
                "kind": self.kind,
                "title": self.title,
                "started_at": self.started_at,
                "ended_at": ended,
                "duration_s": round((ended - self.started_at).total_seconds(), 1),
                "bytes": self.bytes,
                "event_count": len(self.events),
                "truncated": self.truncated,
                "events": self.events,
            })
            olds = self.db.terminal_recordings.find({}, {"_id": 1}).sort("started_at", -1).skip(MAX_RECORDINGS)
            ids = [d["_id"] async for d in olds]
            if ids:
                await self.db.terminal_recordings.delete_many({"_id": {"$in": ids}})
        except Exception:
            pass


def _iso(v):
    return v.isoformat() if isinstance(v, datetime) else v


# Built-in command snippets seeded once on first startup.
DEFAULT_COMMANDS = [
    {"name": "Panel: Update (git pull + rebuild)", "command": "bash /opt/nexus-panel/current/scripts/update.sh"},
    {"name": "Panel: Backup", "command": "bash /opt/nexus-panel/current/scripts/backup.sh"},
    {"name": "Panel: Health Check", "command": "bash /opt/nexus-panel/current/scripts/healthcheck.sh"},
    {"name": "Panel: Renew SSL (all certs)", "command": "bash /opt/nexus-panel/current/scripts/renew-ssl.sh"},
    {"name": "Git: Pull latest (cd into a project first)", "command": "git pull"},
    {"name": "Docker: List containers", "command": "docker ps -a"},
    {"name": "Docker: Compose status (cd project)", "command": "docker compose ps"},
    {"name": "Docker: Follow compose logs (cd project)", "command": "docker compose logs -f --tail 200"},
    {"name": "Docker: Prune unused data", "command": "docker system prune -af"},
    {"name": "Nginx: Test & reload", "command": "nginx -t && nginx -s reload"},
    {"name": "Certbot: List certificates", "command": "certbot certificates"},
    {"name": "System: Disk usage", "command": "df -h"},
    {"name": "System: Memory usage", "command": "free -h"},
    {"name": "System: Top processes", "command": "htop || top"},
    {"name": "System: Update packages", "command": "apt update && apt upgrade -y"},
    {"name": "Projects: Go to apps dir", "command": "cd /opt/nexus-panel/apps && ls -la"},
]


async def seed_default_commands(db):
    """Insert the built-in command library exactly once (tracked via app_meta)."""
    try:
        if await db.app_meta.find_one({"_id": "terminal_defaults_seeded"}):
            return
        now = now_iso()
        docs = [{"name": d["name"], "command": d["command"], "system": True, "created_at": now} for d in DEFAULT_COMMANDS]
        if docs:
            await db.terminal_commands.insert_many(docs)
        await db.app_meta.insert_one({"_id": "terminal_defaults_seeded", "at": now})
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

    # ---- recordings (auto-recorded terminal sessions) ----
    @router.get("/recordings")
    async def list_recordings(limit: int = 100, skip: int = 0, current=Depends(get_current_user)):
        limit = min(max(limit, 1), 200)
        skip = max(skip, 0)
        total = await db.terminal_recordings.count_documents({})
        items = []
        async for d in db.terminal_recordings.find({}, {"events": 0}).sort("started_at", -1).skip(skip).limit(limit):
            d["id"] = str(d.pop("_id"))
            d["started_at"] = _iso(d.get("started_at"))
            d["ended_at"] = _iso(d.get("ended_at"))
            items.append(d)
        return {"items": items, "total": total, "limit": limit, "skip": skip}

    @router.get("/recordings/{rec_id}")
    async def get_recording(rec_id: str, current=Depends(get_current_user)):
        try:
            doc = await db.terminal_recordings.find_one({"_id": ObjectId(rec_id)})
        except Exception:
            doc = None
        if not doc:
            raise HTTPException(status_code=404, detail="Recording not found")
        doc["id"] = str(doc.pop("_id"))
        doc["started_at"] = _iso(doc.get("started_at"))
        doc["ended_at"] = _iso(doc.get("ended_at"))
        return doc

    @router.delete("/recordings/{rec_id}")
    async def delete_recording(rec_id: str, current=Depends(get_current_user)):
        await db.terminal_recordings.delete_one({"_id": ObjectId(rec_id)})
        return {"ok": True}

    @router.delete("/recordings")
    async def clear_recordings(current=Depends(get_current_user)):
        res = await db.terminal_recordings.delete_many({})
        return {"ok": True, "deleted": res.deleted_count}

    return router


# ------------------------------------------------------- websocket sessions ---
def _ws_authed(websocket: WebSocket, get_jwt_secret) -> bool:
    token = websocket.query_params.get("token")
    try:
        jwt.decode(token, get_jwt_secret(), algorithms=["HS256"])
        return True
    except Exception:
        return False


def _ws_username(websocket: WebSocket, get_jwt_secret) -> str:
    token = websocket.query_params.get("token")
    try:
        return jwt.decode(token, get_jwt_secret(), algorithms=["HS256"]).get("sub") or "user"
    except Exception:
        return "user"


async def _ws_role_ok(websocket: WebSocket, get_jwt_secret, db, min_role: str = "admin") -> bool:
    """Terminal access is privileged — require admin+ even though WS bypass HTTP middleware."""
    from auth import role_rank
    if db is None:
        return True
    try:
        sub = jwt.decode(websocket.query_params.get("token"), get_jwt_secret(), algorithms=["HS256"]).get("sub")
        u = await db.users.find_one({"username": sub}, {"role": 1})
        return bool(u) and role_rank(u.get("role")) >= role_rank(min_role)
    except Exception:
        return False


async def local_terminal_session(websocket: WebSocket, get_jwt_secret, db=None):
    if not _ws_authed(websocket, get_jwt_secret):
        await websocket.close(code=1008)
        return
    if not await _ws_role_ok(websocket, get_jwt_secret, db):
        await websocket.close(code=1008)
        return
    await websocket.accept()

    recorder = None
    if db is not None:
        recorder = TerminalRecorder(db, "local", f"Local shell · {_ws_username(websocket, get_jwt_secret)}")

    pid, master_fd = pty.fork()
    if pid == 0:  # child
        os.environ["TERM"] = "xterm-256color"
        # Start the shell in the user's home directory (cd ~).
        try:
            os.chdir(os.path.expanduser("~"))
        except Exception:
            pass
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
            if recorder:
                recorder.record(data)
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
        if recorder:
            await recorder.save()
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
    if not await _ws_role_ok(websocket, get_jwt_secret, db):
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
    recorder = TerminalRecorder(db, "ssh", f"SSH · {server.name} ({server.username}@{server.host})")

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
                recorder.record(data)
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
        await recorder.save()
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
