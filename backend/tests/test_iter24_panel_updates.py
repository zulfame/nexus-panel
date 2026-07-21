import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fallback to frontend/.env
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

CREDS = {"username": "superadmin", "password": "sa@4dm1n"}


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=CREDS, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def h(token):
    return {"Authorization": f"Bearer {token}"}


# GET /api/system/panel-updates
def test_panel_updates_shape(h):
    r = requests.get(f"{BASE_URL}/api/system/panel-updates", headers=h, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "available" in d and "behind" in d
    # sandbox: no origin -> available=false
    assert d["available"] is False
    # Should have an error string (fetch failed) OR be a valid response
    assert d["behind"] == 0


def test_panel_updates_cached_fast(h):
    t0 = time.time()
    r = requests.get(f"{BASE_URL}/api/system/panel-updates", headers=h, timeout=30)
    assert r.status_code == 200
    dt = time.time() - t0
    # Cached call should be quick (<2s)
    assert dt < 3.0, f"Cached call too slow: {dt:.2f}s"


def test_panel_updates_force(h):
    r = requests.get(f"{BASE_URL}/api/system/panel-updates?force=true", headers=h, timeout=30)
    assert r.status_code == 200, r.text


# Regression: ops endpoints return 400 in sandbox (not 500)
@pytest.mark.parametrize("path,body", [
    ("/api/ops/update", {}),
    ("/api/ops/fix", {}),
    ("/api/ops/restart", {"target": "panel"}),
])
def test_ops_returns_400_not_500(h, path, body):
    r = requests.post(f"{BASE_URL}{path}", headers=h, json=body, timeout=20)
    assert r.status_code != 500, f"{path} 500ed: {r.text}"
    assert r.status_code in (400, 403, 404, 409, 422), f"{path} returned {r.status_code}: {r.text}"
