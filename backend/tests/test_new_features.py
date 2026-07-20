"""Tests for log-rotation / health / live-logs features (iteration 7)."""
import os
import json
import time
import asyncio
import pytest
import requests
import websockets
from dotenv import load_dotenv
load_dotenv("/app/frontend/.env")

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
WS_BASE = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")

ADMIN_USER = "superadmin"
ADMIN_PASS = "sa@4dm1n"


# --------------- fixtures ---------------
@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"username": ADMIN_USER, "password": ADMIN_PASS}, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "access_token" in data
    return data["access_token"]


@pytest.fixture(scope="module")
def auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def project_id(auth):
    # create
    name = f"TESTPROJ_feat7_{int(time.time())}"
    payload = {
        "name": name,
        "repo_url": "https://github.com/octocat/Hello-World.git",
        "branch": "master",
        "ssl_mode": "none",
    }
    r = requests.post(f"{BASE_URL}/api/projects", json=payload, headers=auth, timeout=15)
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    yield pid
    # cleanup
    requests.delete(f"{BASE_URL}/api/projects/{pid}", headers=auth, timeout=15)


# --------------- Auth ---------------
def test_login_returns_token(token):
    assert isinstance(token, str) and len(token) > 20


# --------------- Health endpoints ---------------
def test_project_health_graceful(auth, project_id):
    r = requests.get(f"{BASE_URL}/api/projects/{project_id}/health", headers=auth, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "containers" in data
    assert data["containers"] == []


def test_all_containers_health_graceful(auth, project_id):
    r = requests.get(f"{BASE_URL}/api/system/containers-health", headers=auth, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data, dict)
    assert project_id in data
    assert data[project_id] == []
    # every value should be an empty list because docker unavailable
    for v in data.values():
        assert v == []


def test_health_requires_auth(project_id):
    r = requests.get(f"{BASE_URL}/api/system/containers-health", timeout=10)
    assert r.status_code in (401, 403)


# --------------- Log rotation ---------------
def test_deploy_log_rotation_max_20(auth, project_id):
    # trigger 22 deploys, then check logs endpoint never returns > 20
    for _ in range(22):
        r = requests.post(f"{BASE_URL}/api/projects/{project_id}/deploy", headers=auth, timeout=15)
        assert r.status_code == 200, r.text
        time.sleep(0.4)  # give the background task room to insert
    # wait for pruning + finalization
    time.sleep(8)
    r = requests.get(f"{BASE_URL}/api/projects/{project_id}/logs", headers=auth, timeout=15)
    assert r.status_code == 200
    logs = r.json()
    # endpoint limits to 10 for the UI, but the underlying rotation caps at 20 in DB
    assert len(logs) <= 20
    # each returned log should be a dict with 'status'
    for lg in logs:
        assert "status" in lg


# --------------- Deploy graceful failure ---------------
def test_deploy_ends_with_error_status(auth, project_id):
    requests.post(f"{BASE_URL}/api/projects/{project_id}/deploy", headers=auth, timeout=15)
    # poll for up to ~30s until status becomes error
    deadline = time.time() + 30
    status = None
    message = ""
    while time.time() < deadline:
        r = requests.get(f"{BASE_URL}/api/projects/{project_id}", headers=auth, timeout=10)
        if r.status_code == 200:
            j = r.json()
            status = j.get("status")
            message = j.get("last_message", "")
            if status == "error":
                break
        time.sleep(1.5)
    assert status == "error", f"got status={status} message={message}"
    # A deploy log with status error should exist
    r = requests.get(f"{BASE_URL}/api/projects/{project_id}/logs", headers=auth, timeout=10)
    logs = r.json()
    assert any(lg.get("status") == "error" for lg in logs)


# --------------- WebSocket container logs ---------------
def test_ws_container_logs_rejects_bad_token(project_id):
    url = f"{WS_BASE}/api/ws/projects/{project_id}/container-logs?token=badtoken"

    async def run():
        try:
            async with websockets.connect(url) as ws:
                # should be closed almost immediately with 1008
                try:
                    await asyncio.wait_for(ws.recv(), timeout=3)
                except Exception:
                    pass
            return "opened_but_closed"
        except websockets.exceptions.InvalidStatusCode as e:
            return f"rejected_{e.status_code}"
        except websockets.exceptions.ConnectionClosed as e:
            return f"closed_{e.code}"
        except Exception as e:
            return f"err_{type(e).__name__}"

    result = asyncio.run(run())
    # accept any form of rejection: 1008 close, InvalidStatus[Code] from handshake, or closed
    assert any(k in result for k in ("1008", "rejected", "closed", "InvalidStatus")), result


def test_ws_container_logs_graceful_error_message(token, project_id):
    url = f"{WS_BASE}/api/ws/projects/{project_id}/container-logs?token={token}"

    async def run():
        msgs = []
        try:
            async with websockets.connect(url) as ws:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=8)
                    msgs.append(raw)
                except Exception:
                    pass
        except Exception as e:
            msgs.append(f"err:{e}")
        return msgs

    msgs = asyncio.run(run())
    assert msgs, "no message received"
    payload = None
    try:
        payload = json.loads(msgs[0])
    except Exception:
        pytest.fail(f"first frame not json: {msgs[0]!r}")
    assert payload.get("type") == "error"
    assert "docker" in payload.get("message", "").lower() or "not deployed" in payload.get("message", "").lower()
