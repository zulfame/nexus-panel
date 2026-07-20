"""Iteration 8 tests: DNS check, Renew SSL, and restart-loop monitor regression."""
import os
import time
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
ADMIN_USER = "superadmin"
ADMIN_PASS = "sa@4dm1n"


@pytest.fixture(scope="module")
def auth():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"username": ADMIN_USER, "password": ADMIN_PASS}, timeout=15)
    assert r.status_code == 200, r.text
    tok = r.json()["access_token"]
    return {"Authorization": f"Bearer {tok}"}


def _create_project(auth, ssl_mode="letsencrypt", domain="example.com"):
    payload = {
        "name": f"TESTPROJ_iter8_{ssl_mode}_{int(time.time()*1000)}",
        "repo_url": "https://github.com/octocat/Hello-World.git",
        "branch": "master",
        "ssl_mode": ssl_mode,
    }
    if domain:
        payload["domain"] = domain
    r = requests.post(f"{BASE_URL}/api/projects", json=payload, headers=auth, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["id"]


@pytest.fixture
def le_project(auth):
    pid = _create_project(auth, "letsencrypt", "example.com")
    yield pid
    requests.delete(f"{BASE_URL}/api/projects/{pid}", headers=auth, timeout=15)


@pytest.fixture
def le_no_domain_project(auth):
    pid = _create_project(auth, "letsencrypt", None)
    yield pid
    requests.delete(f"{BASE_URL}/api/projects/{pid}", headers=auth, timeout=15)


@pytest.fixture
def none_project(auth):
    pid = _create_project(auth, "none", "example.com")
    yield pid
    requests.delete(f"{BASE_URL}/api/projects/{pid}", headers=auth, timeout=15)


# ----------------- Auth ----------------
def test_auth_login_returns_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"username": ADMIN_USER, "password": ADMIN_PASS}, timeout=15)
    assert r.status_code == 200
    j = r.json()
    assert "access_token" in j and isinstance(j["access_token"], str)


# ----------------- DNS check ----------------
def test_dns_check_with_domain(auth, le_project):
    r = requests.get(f"{BASE_URL}/api/projects/{le_project}/dns-check", headers=auth, timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    for k in ("domain", "server_ip", "resolved_ips", "matches"):
        assert k in data, f"missing key {k}"
    assert data["domain"] == "example.com"
    assert isinstance(data["resolved_ips"], list)
    assert len(data["resolved_ips"]) > 0, "example.com should resolve to some IPs"
    assert isinstance(data["matches"], bool)
    assert data["matches"] is False, "example.com should not match sandbox server IP"


def test_dns_check_no_domain(auth, le_no_domain_project):
    r = requests.get(f"{BASE_URL}/api/projects/{le_no_domain_project}/dns-check",
                     headers=auth, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["domain"] is None
    assert data["resolved_ips"] == []
    assert data["matches"] is False


# ----------------- Renew SSL ----------------
def test_renew_ssl_letsencrypt_ok(auth, le_project):
    r = requests.post(f"{BASE_URL}/api/projects/{le_project}/renew-ssl",
                      headers=auth, timeout=15)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j.get("ok") is True
    assert "message" in j
    # give background task time to create the ssl deploy log
    time.sleep(3)
    r2 = requests.get(f"{BASE_URL}/api/projects/{le_project}/logs", headers=auth, timeout=15)
    assert r2.status_code == 200
    logs = r2.json()
    ssl_logs = [lg for lg in logs if lg.get("action") == "ssl"]
    assert ssl_logs, f"expected an ssl deploy log, got actions={[lg.get('action') for lg in logs]}"


def test_renew_ssl_guard_none_mode(auth, none_project):
    r = requests.post(f"{BASE_URL}/api/projects/{none_project}/renew-ssl",
                      headers=auth, timeout=15)
    assert r.status_code == 400, r.text
    detail = r.json().get("detail", "")
    assert "Let's Encrypt" in detail or "letsencrypt" in detail.lower()


# ----------------- Regression ----------------
def test_health_endpoint_regression(auth, le_project):
    r = requests.get(f"{BASE_URL}/api/projects/{le_project}/health", headers=auth, timeout=15)
    assert r.status_code == 200
    assert r.json().get("containers") == []


def test_system_containers_health_regression(auth):
    r = requests.get(f"{BASE_URL}/api/system/containers-health", headers=auth, timeout=15)
    assert r.status_code == 200
    assert isinstance(r.json(), dict)


def test_deploy_endpoint_regression(auth, none_project):
    r = requests.post(f"{BASE_URL}/api/projects/{none_project}/deploy",
                      headers=auth, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json().get("ok") is True


def test_restart_monitor_no_crash(auth):
    # Just verify server still responds after monitor has been running
    r = requests.get(f"{BASE_URL}/api/system/containers-health", headers=auth, timeout=15)
    assert r.status_code == 200
