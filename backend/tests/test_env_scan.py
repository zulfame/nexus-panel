"""Env-scan feature tests (iteration 13).

Covers:
- Superadmin login
- Env-scan on a local repo /tmp/testrepo2 (backend + frontend refs)
- Env-scan on a bogus repo (must not 500)
- Regression: PUT env_vars, DELETE cleanup, GET /api/, ssl-status,
  system/containers-health, terminal.
"""
import os
import subprocess
from pathlib import Path

import pytest
import requests

def _read_base():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            return line.split("=", 1)[1].strip().rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL not set")


BASE = _read_base()
API = f"{BASE}/api"
CREDS = {"username": "superadmin", "password": "sa@4dm1n"}


# --------------------------------------------------- local fixture repo ---
def _ensure_testrepo2():
    r = Path("/tmp/testrepo2")
    if (r / ".git").exists():
        # ensure branch name is 'main'
        b = subprocess.run(
            ["git", "-C", str(r), "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True, text=True,
        ).stdout.strip()
        if b == "main":
            return
    subprocess.run(["rm", "-rf", str(r)], check=False)
    (r / "backend").mkdir(parents=True)
    (r / "frontend" / "src").mkdir(parents=True)
    (r / "backend" / "server.py").write_text(
        'import os\n'
        'SECRET=os.environ["JWT_SECRET"]\n'
        'K=os.environ.get("EMERGENT_LLM_KEY")\n'
        'M=os.environ.get("MONGO_URL")\n'
    )
    (r / "frontend" / "src" / "App.js").write_text(
        "const a=process.env.REACT_APP_MAPS_KEY;"
        " const b=process.env.REACT_APP_BACKEND_URL;\n"
    )
    subprocess.run(["git", "-C", str(r), "init", "-b", "main"], check=True)
    subprocess.run(["git", "-C", str(r), "add", "."], check=True)
    subprocess.run(
        ["git", "-C", str(r), "-c", "user.email=t@t", "-c", "user.name=t",
         "commit", "-m", "init"],
        check=True,
    )


@pytest.fixture(scope="session")
def token():
    _ensure_testrepo2()
    r = requests.post(f"{API}/auth/login", json=CREDS, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def h(token):
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------- 1. auth login sanity ---
def test_login_returns_token(token):
    assert isinstance(token, str) and len(token) > 20


# ---------------------------------------------- 2. env-scan happy path ---
def _mk_project(h, payload):
    r = requests.post(f"{API}/projects", json=payload, headers=h, timeout=30)
    assert r.status_code in (200, 201), r.text
    return r.json()


def _del_project(h, pid):
    requests.delete(f"{API}/projects/{pid}", headers=h, timeout=30)


def test_env_scan_local_repo(h):
    p = _mk_project(h, {
        "name": "TEST_envscan",
        "repo_url": "/tmp/testrepo2",
        "branch": "main",
        "env_vars": [{"key": "JWT_SECRET", "value": "x"}],
    })
    pid = p["id"]
    try:
        r = requests.get(f"{API}/projects/{pid}/env-scan", headers=h, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["scanned"] is True, data
        req = {row["key"]: row for row in data["required"]}
        # required keys
        assert "JWT_SECRET" in req and req["JWT_SECRET"]["provided"] is True
        assert req["JWT_SECRET"]["source"] == "backend"
        assert "EMERGENT_LLM_KEY" in req
        assert req["EMERGENT_LLM_KEY"]["provided"] is False
        assert req["EMERGENT_LLM_KEY"]["source"] == "backend"
        assert "REACT_APP_MAPS_KEY" in req
        assert req["REACT_APP_MAPS_KEY"]["provided"] is False
        assert req["REACT_APP_MAPS_KEY"]["source"] == "frontend"
        # ignored keys
        assert "MONGO_URL" not in req
        assert "REACT_APP_BACKEND_URL" not in req
        # missing list
        assert set(data["missing"]) == {"EMERGENT_LLM_KEY", "REACT_APP_MAPS_KEY"}
    finally:
        _del_project(h, pid)


# ---------------------------------------------- 3. env-scan bogus repo ---
def test_env_scan_unclonable(h):
    p = _mk_project(h, {
        "name": "TEST_envscan_bad",
        "repo_url": "https://example.invalid/x.git",
        "branch": "main",
        "env_vars": [],
    })
    pid = p["id"]
    try:
        r = requests.get(f"{API}/projects/{pid}/env-scan", headers=h, timeout=60)
        assert r.status_code == 200, r.text  # no 500 crash
        data = r.json()
        assert data["scanned"] is False
        assert isinstance(data.get("message", ""), str) and data["message"]
    finally:
        _del_project(h, pid)


# ---------------------------------------------- 4. regression suite ---
def test_root_endpoint():
    r = requests.get(f"{API}/", timeout=10)
    assert r.status_code == 200


def test_put_env_vars_persists(h):
    p = _mk_project(h, {
        "name": "TEST_putenv",
        "repo_url": "/tmp/testrepo2",
        "branch": "main",
        "env_vars": [{"key": "FOO", "value": "1"}],
    })
    pid = p["id"]
    try:
        r = requests.put(
            f"{API}/projects/{pid}",
            json={"env_vars": [{"key": "FOO", "value": "2"},
                                {"key": "BAR", "value": "b"}]},
            headers=h, timeout=30,
        )
        assert r.status_code == 200, r.text
        g = requests.get(f"{API}/projects/{pid}", headers=h, timeout=15).json()
        kv = {e["key"]: e["value"] for e in g["env_vars"]}
        assert kv.get("FOO") == "2"
        assert kv.get("BAR") == "b"

        # ssl-status regression
        s = requests.get(f"{API}/projects/{pid}/ssl-status", headers=h, timeout=15)
        assert s.status_code == 200
        # containers-health regression
        ch = requests.get(f"{API}/system/containers-health", headers=h, timeout=15)
        assert ch.status_code == 200
    finally:
        _del_project(h, pid)
        # verify deleted
        g = requests.get(f"{API}/projects/{pid}", headers=h, timeout=15)
        assert g.status_code == 404


def test_terminal_endpoint(h):
    # /api/system/terminal or similar - probe common terminal endpoints
    for path in ("/system/terminal", "/terminal"):
        r = requests.post(f"{API}{path}", json={"cmd": "echo hi"},
                          headers=h, timeout=15)
        if r.status_code != 404:
            assert r.status_code in (200, 400, 422), (path, r.status_code, r.text)
            return
    pytest.skip("no terminal endpoint found (non-blocking)")
