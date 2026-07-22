"""Phase 1 security hardening regression tests for Nexus Panel."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://nexus-panel-2.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_USER = "superadmin"
ADMIN_PASS = "sa@4dm1n"


def _login(username=ADMIN_USER, password=ADMIN_PASS, remember=False):
    r = requests.post(f"{API}/auth/login", json={"username": username, "password": password, "remember": remember}, timeout=30)
    return r


@pytest.fixture
def admin_token():
    r = _login()
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "access_token" in data and "user" in data
    return data["access_token"]


def _auth(tok):
    return {"Authorization": f"Bearer {tok}"}


# --- Login & /me ---
def test_login_returns_token_and_user():
    r = _login()
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("access_token")
    assert body.get("user", {}).get("username") == ADMIN_USER


def test_me_with_valid_token(admin_token):
    r = requests.get(f"{API}/auth/me", headers=_auth(admin_token), timeout=15)
    assert r.status_code == 200, r.text
    u = r.json()
    assert u.get("username") == ADMIN_USER
    # Regression: role field still present
    assert "role" in u, f"role missing from /me response: {u}"


# --- Session revoke single ---
def test_logout_revokes_current_token():
    tok = _login().json()["access_token"]
    # sanity
    r = requests.get(f"{API}/auth/me", headers=_auth(tok), timeout=15)
    assert r.status_code == 200
    # logout
    r = requests.post(f"{API}/auth/logout", headers=_auth(tok), timeout=15)
    assert r.status_code in (200, 204), r.text
    # reuse same token -> 401 revoked
    r = requests.get(f"{API}/auth/me", headers=_auth(tok), timeout=15)
    assert r.status_code == 401
    detail = (r.json().get("detail") or "").lower()
    assert "revoke" in detail or "revoked" in detail, f"detail should mention revoked, got: {detail}"


# --- Logout all ---
def test_logout_all_invalidates_other_sessions():
    tokA = _login().json()["access_token"]
    tokB = _login().json()["access_token"]
    assert tokA != tokB
    # both valid initially
    assert requests.get(f"{API}/auth/me", headers=_auth(tokA), timeout=15).status_code == 200
    assert requests.get(f"{API}/auth/me", headers=_auth(tokB), timeout=15).status_code == 200
    # logout-all with A
    r = requests.post(f"{API}/auth/logout-all", headers=_auth(tokA), timeout=15)
    assert r.status_code in (200, 204), r.text
    # B should now be invalid
    rb = requests.get(f"{API}/auth/me", headers=_auth(tokB), timeout=15)
    assert rb.status_code == 401
    detail = (rb.json().get("detail") or "").lower()
    assert "expire" in detail or "session" in detail or "invalid" in detail or "revoke" in detail, detail
    # fresh login after logout-all succeeds
    r = _login()
    assert r.status_code == 200 and r.json().get("access_token")


# --- Brute force lockout (use throwaway username) ---
def test_brute_force_lockout_per_ip_username():
    fake_user = "nosuchuser_bf_test"
    codes = []
    for i in range(5):
        r = _login(username=fake_user, password="wrongpass")
        codes.append(r.status_code)
    # 6th should be 429
    r6 = _login(username=fake_user, password="wrongpass")
    assert all(c == 401 for c in codes), f"expected 5x401 got: {codes}"
    assert r6.status_code == 429, f"expected 429 on 6th, got {r6.status_code} {r6.text}"
    detail = (r6.json().get("detail") or "").lower()
    assert "too many" in detail or "attempt" in detail or "lock" in detail, detail


# --- Env secret plaintext round trip ---
def test_env_secret_plaintext_roundtrip(admin_token):
    payload = {
        "name": f"TEST_secret_proj_{int(time.time())}",
        "repo_url": "https://example.com/repo.git",
        "branch": "main",
        "env_vars": [{"key": "SECRET_KEY", "value": "plain-secret-xyz"}],
    }
    r = requests.post(f"{API}/projects", headers=_auth(admin_token), json=payload, timeout=30)
    assert r.status_code in (200, 201), f"create failed: {r.status_code} {r.text}"
    proj = r.json()
    pid = proj.get("id") or proj.get("_id")
    assert pid, f"no id in create response: {proj}"
    try:
        rg = requests.get(f"{API}/projects/{pid}", headers=_auth(admin_token), timeout=15)
        assert rg.status_code == 200, rg.text
        got = rg.json()
        envs = got.get("env_vars") or []
        found = next((e for e in envs if e.get("key") == "SECRET_KEY"), None)
        assert found is not None, f"SECRET_KEY missing: {envs}"
        assert found.get("value") == "plain-secret-xyz", f"expected plaintext round-trip, got: {found}"
    finally:
        requests.delete(f"{API}/projects/{pid}", headers=_auth(admin_token), timeout=15)


# --- Rate limit does not falsely block ---
def test_rate_limit_allows_normal_usage(admin_token):
    statuses = []
    for _ in range(40):
        r = requests.get(f"{API}/auth/me", headers=_auth(admin_token), timeout=15)
        statuses.append(r.status_code)
    assert all(s == 200 for s in statuses), f"unexpected statuses: {set(statuses)} counts={statuses.count(200)}/40"


# --- Protected route requires auth ---
def test_projects_requires_auth():
    r = requests.get(f"{API}/projects", timeout=15)
    assert r.status_code == 401


def test_projects_list_with_auth(admin_token):
    r = requests.get(f"{API}/projects", headers=_auth(admin_token), timeout=15)
    assert r.status_code == 200
    assert isinstance(r.json(), list)
