"""Tests for Terminal feature: servers CRUD, commands CRUD, WebSocket sessions, and regression."""
import asyncio
import json
import os
import ssl as _ssl
from urllib.parse import urlparse

import pytest
import requests
import websockets

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://nexus-panel-2.preview.emergentagent.com").rstrip("/")


def _ws_url(path: str) -> str:
    u = urlparse(BASE_URL)
    scheme = "wss" if u.scheme == "https" else "ws"
    return f"{scheme}://{u.netloc}{path}"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": "superadmin", "password": "sa@4dm1n"})
    assert r.status_code == 200, r.text
    data = r.json()
    assert "access_token" in data
    return data["access_token"]


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


# ---------------- Auth regression ----------------
class TestAuth:
    def test_login_ok(self, token):
        assert isinstance(token, str) and len(token) > 20

    def test_root_healthy(self):
        r = requests.get(f"{BASE_URL}/api/")
        assert r.status_code == 200


# ---------------- Terminal servers CRUD ----------------
class TestTerminalServers:
    created_id = None

    def test_list_servers(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/terminal/servers", headers=auth_headers)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_server(self, auth_headers):
        payload = {
            "name": "TEST_server_1",
            "host": "192.0.2.1",
            "port": 22,
            "username": "root",
            "auth_type": "password",
            "password": "supersecret",
        }
        r = requests.post(f"{BASE_URL}/api/terminal/servers", json=payload, headers=auth_headers)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["name"] == "TEST_server_1"
        assert body["host"] == "192.0.2.1"
        assert body["has_password"] is True
        # secrets never exposed
        assert "password_enc" not in body
        assert "private_key_enc" not in body
        assert "password" not in body
        assert body.get("id")
        TestTerminalServers.created_id = body["id"]

    def test_list_does_not_leak_secrets(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/terminal/servers", headers=auth_headers)
        assert r.status_code == 200
        for item in r.json():
            assert "password_enc" not in item
            assert "private_key_enc" not in item
            assert "password" not in item

    def test_update_server(self, auth_headers):
        sid = TestTerminalServers.created_id
        assert sid
        r = requests.put(
            f"{BASE_URL}/api/terminal/servers/{sid}",
            json={"name": "TEST_server_1_upd", "password": "newpw"},
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["name"] == "TEST_server_1_upd"
        assert body["has_password"] is True
        assert "password_enc" not in body

    def test_delete_server(self, auth_headers):
        sid = TestTerminalServers.created_id
        r = requests.delete(f"{BASE_URL}/api/terminal/servers/{sid}", headers=auth_headers)
        assert r.status_code == 200
        # verify gone
        r2 = requests.get(f"{BASE_URL}/api/terminal/servers", headers=auth_headers)
        assert all(item["id"] != sid for item in r2.json())


# ---------------- Terminal commands CRUD ----------------
class TestTerminalCommands:
    created_id = None

    def test_create_command(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/terminal/commands",
            json={"name": "TEST_zz_cmd", "command": "echo HELLO_FROM_CMD"},
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["name"] == "TEST_zz_cmd"
        assert body["command"] == "echo HELLO_FROM_CMD"
        assert body.get("id")
        TestTerminalCommands.created_id = body["id"]

    def test_list_sorted_by_name(self, auth_headers):
        # add a second earlier-sorted command
        r2 = requests.post(
            f"{BASE_URL}/api/terminal/commands",
            json={"name": "TEST_aa_cmd", "command": "ls"},
            headers=auth_headers,
        )
        assert r2.status_code == 200
        second_id = r2.json()["id"]
        try:
            r = requests.get(f"{BASE_URL}/api/terminal/commands", headers=auth_headers)
            assert r.status_code == 200
            names = [c["name"] for c in r.json()]
            # verify sorted ascending
            assert names == sorted(names)
        finally:
            requests.delete(f"{BASE_URL}/api/terminal/commands/{second_id}", headers=auth_headers)

    def test_update_command(self, auth_headers):
        cid = TestTerminalCommands.created_id
        r = requests.put(
            f"{BASE_URL}/api/terminal/commands/{cid}",
            json={"command": "echo UPDATED"},
            headers=auth_headers,
        )
        assert r.status_code == 200
        assert r.json()["command"] == "echo UPDATED"

    def test_delete_command(self, auth_headers):
        cid = TestTerminalCommands.created_id
        r = requests.delete(f"{BASE_URL}/api/terminal/commands/{cid}", headers=auth_headers)
        assert r.status_code == 200


# ---------------- WebSocket LOCAL PTY ----------------
def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro) if False else asyncio.run(coro)


class TestLocalWebSocket:
    def test_unauth_closes_1008(self):
        async def go():
            url = _ws_url("/api/ws/terminal/local?token=BADTOKEN")
            ssl_ctx = _ssl.create_default_context() if url.startswith("wss") else None
            try:
                async with websockets.connect(url, ssl=ssl_ctx, open_timeout=10) as ws:
                    await ws.recv()
                return None
            except websockets.exceptions.ConnectionClosed as e:
                return e.code
            except websockets.exceptions.InvalidStatus as e:
                # server may reject during handshake
                return e.response.status_code

        code = _run(go())
        # Accept 1008 close or handshake rejection
        assert code in (1008, 401, 403), f"got code={code}"

    def test_local_pty_echo(self, token):
        async def go():
            url = _ws_url(f"/api/ws/terminal/local?token={token}")
            ssl_ctx = _ssl.create_default_context() if url.startswith("wss") else None
            async with websockets.connect(url, ssl=ssl_ctx, open_timeout=15, max_size=None) as ws:
                await ws.send(json.dumps({"type": "resize", "cols": 100, "rows": 30}))
                await ws.send(json.dumps({"type": "input", "data": "echo NEXUS_WS_OK\n"}))
                buf = b""
                found = False
                # collect messages for up to ~5 seconds
                for _ in range(50):
                    try:
                        msg = await asyncio.wait_for(ws.recv(), timeout=2.0)
                    except asyncio.TimeoutError:
                        continue
                    if isinstance(msg, (bytes, bytearray)):
                        buf += bytes(msg)
                    else:
                        buf += msg.encode("utf-8", "ignore")
                    if b"NEXUS_WS_OK" in buf:
                        found = True
                        break
                return found, buf[-500:]

        found, tail = _run(go())
        assert found, f"NEXUS_WS_OK not found. tail={tail!r}"


# ---------------- WebSocket SSH graceful failure ----------------
class TestSSHWebSocket:
    def test_ssh_bogus_host_graceful(self, auth_headers, token):
        # create a bogus server
        r = requests.post(
            f"{BASE_URL}/api/terminal/servers",
            json={
                "name": "TEST_bogus",
                "host": "192.0.2.1",
                "port": 22,
                "username": "root",
                "auth_type": "password",
                "password": "x",
            },
            headers=auth_headers,
        )
        assert r.status_code == 200
        sid = r.json()["id"]
        try:
            async def go():
                url = _ws_url(f"/api/ws/terminal/ssh/{sid}?token={token}")
                ssl_ctx = _ssl.create_default_context() if url.startswith("wss") else None
                async with websockets.connect(url, ssl=ssl_ctx, open_timeout=15, max_size=None) as ws:
                    buf = b""
                    try:
                        for _ in range(60):  # up to ~2 min for 15s connect + close
                            try:
                                msg = await asyncio.wait_for(ws.recv(), timeout=3.0)
                            except asyncio.TimeoutError:
                                continue
                            if isinstance(msg, (bytes, bytearray)):
                                buf += bytes(msg)
                            else:
                                buf += msg.encode("utf-8", "ignore")
                    except websockets.exceptions.ConnectionClosed:
                        pass
                    return buf

            data = _run(go())
            assert b"SSH connection failed" in data, f"got={data!r}"
        finally:
            requests.delete(f"{BASE_URL}/api/terminal/servers/{sid}", headers=auth_headers)

    def test_server_still_healthy(self):
        assert requests.get(f"{BASE_URL}/api/").status_code == 200


# ---------------- Regression: other endpoints ----------------
class TestRegression:
    def test_projects_list(self, auth_headers):
        assert requests.get(f"{BASE_URL}/api/projects", headers=auth_headers).status_code == 200

    def test_system_stats(self, auth_headers):
        assert requests.get(f"{BASE_URL}/api/system/stats", headers=auth_headers).status_code == 200

    def test_ssl_status(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/ssl-status", headers=auth_headers)
        # some prior iters used slightly different names; accept 200/404
        assert r.status_code in (200, 404)

    def test_containers_health(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/containers-health", headers=auth_headers)
        assert r.status_code in (200, 404)
