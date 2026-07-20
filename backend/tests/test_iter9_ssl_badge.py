"""Iteration 9: SSL status endpoints, DNS check, renew SSL, backend startup regression."""
import os
import time
import pytest
import requests

def _base():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    # fallback: read frontend/.env
    for line in open("/app/frontend/.env"):
        if line.startswith("REACT_APP_BACKEND_URL="):
            return line.split("=", 1)[1].strip().rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL not found")

BASE = _base()
API = f"{BASE}/api"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"username": "superadmin", "password": "sa@4dm1n"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def h(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def created_projects(h):
    ids = []
    # letsencrypt project with domain
    r = requests.post(
        f"{API}/projects",
        headers=h,
        json={
            "name": "TESTPROJ_iter9_le",
            "repo_url": "https://github.com/octocat/Hello-World",
            "branch": "master",
            "domain": "example.com",
            "ssl_mode": "letsencrypt",
            "ssl_email": "test@example.com",
        },
        timeout=15,
    )
    assert r.status_code == 200, r.text
    ids.append(("le", r.json()["id"]))
    # ssl_mode=none project
    r = requests.post(
        f"{API}/projects",
        headers=h,
        json={
            "name": "TESTPROJ_iter9_none",
            "repo_url": "https://github.com/octocat/Hello-World",
            "branch": "master",
            "domain": "example.org",
            "ssl_mode": "none",
        },
        timeout=15,
    )
    assert r.status_code == 200, r.text
    ids.append(("none", r.json()["id"]))
    yield dict(ids)
    for _, pid in ids:
        requests.delete(f"{API}/projects/{pid}", headers=h, timeout=15)


def test_root():
    r = requests.get(f"{API}/", timeout=10)
    assert r.status_code == 200


def test_login(token):
    assert isinstance(token, str) and len(token) > 20


def test_ssl_status_letsencrypt_pending(h, created_projects):
    pid = created_projects["le"]
    r = requests.get(f"{API}/projects/{pid}/ssl-status", headers=h, timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert d["mode"] == "letsencrypt"
    assert d["state"] == "pending"
    assert d["expires_at"] is None


def test_ssl_status_none_http(h, created_projects):
    pid = created_projects["none"]
    r = requests.get(f"{API}/projects/{pid}/ssl-status", headers=h, timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert d["mode"] == "none"
    assert d["state"] == "http"


def test_system_ssl_status_dict(h, created_projects):
    r = requests.get(f"{API}/system/ssl-status", headers=h, timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert isinstance(d, dict)
    for _, pid in created_projects.items():
        assert pid in d
        assert "state" in d[pid]


def test_dns_check_shape(h, created_projects):
    pid = created_projects["le"]
    r = requests.get(f"{API}/projects/{pid}/dns-check", headers=h, timeout=20)
    assert r.status_code == 200
    d = r.json()
    for k in ("domain", "server_ip", "resolved_ips", "matches"):
        assert k in d
    assert d["domain"] == "example.com"
    assert isinstance(d["resolved_ips"], list)
    assert len(d["resolved_ips"]) >= 1  # example.com resolves


def test_renew_ssl_letsencrypt(h, created_projects):
    pid = created_projects["le"]
    r = requests.post(f"{API}/projects/{pid}/renew-ssl", headers=h, timeout=15)
    assert r.status_code == 200
    assert r.json().get("ok") is True


def test_renew_ssl_none_400(h, created_projects):
    pid = created_projects["none"]
    r = requests.post(f"{API}/projects/{pid}/renew-ssl", headers=h, timeout=15)
    assert r.status_code == 400


def test_project_health(h, created_projects):
    pid = created_projects["le"]
    r = requests.get(f"{API}/projects/{pid}/health", headers=h, timeout=15)
    assert r.status_code == 200
    assert "containers" in r.json()


def test_system_containers_health(h):
    r = requests.get(f"{API}/system/containers-health", headers=h, timeout=15)
    assert r.status_code == 200
    assert isinstance(r.json(), dict)


def test_capabilities_sandbox(h):
    r = requests.get(f"{API}/capabilities", headers=h, timeout=15)
    assert r.status_code == 200
    caps = r.json()
    assert caps.get("docker") is False
    assert caps.get("certbot") is False


def test_backend_startup_no_scheduler_errors():
    """Backend log should not contain restart_loop_monitor or ssl_renew_scheduler exceptions."""
    for path in ("/var/log/supervisor/backend.err.log", "/var/log/supervisor/backend.out.log"):
        if not os.path.exists(path):
            continue
        with open(path, "r", errors="replace") as f:
            tail = f.read()[-8000:]
        assert "restart monitor:" not in tail.lower() or "warning" in tail.lower()
        # ensure no Traceback for ssl renew scheduler
        assert "ssl renew scheduler" not in tail.lower() or "warning" in tail.lower()
