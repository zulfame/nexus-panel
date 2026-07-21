"""Iteration 22 tests: /api/system/changelog, /api/ops/{update,fix,restart}, project.environment."""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://nexus-panel-2.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": "superadmin", "password": "sa@4dm1n"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}"}


# --- /api/system/changelog ---
def test_changelog_returns_releases(headers):
    r = requests.get(f"{BASE_URL}/api/system/changelog", headers=headers, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "releases" in data
    releases = data["releases"]
    assert isinstance(releases, list) and len(releases) > 0
    first = releases[0]
    assert first["version"] == "1.4.0", f"expected 1.4.0 got {first.get('version')}"
    assert first.get("date"), "date missing"
    assert isinstance(first.get("sections"), list) and len(first["sections"]) > 0
    for sec in first["sections"]:
        assert "type" in sec and "items" in sec
        assert isinstance(sec["items"], list)
        for it in sec["items"]:
            assert "**" not in it, f"markdown ** leak: {it}"
            assert "`" not in it, f"backtick leak: {it}"


# --- /api/ops/{update,fix,restart} graceful 400 in sandbox ---
def test_ops_update_no_scripts(headers):
    r = requests.post(f"{BASE_URL}/api/ops/update", headers=headers, timeout=15)
    assert r.status_code == 400, f"expected 400 got {r.status_code}: {r.text}"
    assert "not found" in r.text.lower() or "vps" in r.text.lower()


def test_ops_fix_no_scripts(headers):
    r = requests.post(f"{BASE_URL}/api/ops/fix", headers=headers, timeout=15)
    assert r.status_code == 400, r.text
    assert "not found" in r.text.lower() or "vps" in r.text.lower()


def test_ops_restart_panel(headers):
    r = requests.post(f"{BASE_URL}/api/ops/restart", headers=headers, json={"target": "panel"}, timeout=15)
    assert r.status_code == 400, r.text
    assert "server operations" in r.text.lower() or "vps" in r.text.lower()


def test_ops_restart_server(headers):
    r = requests.post(f"{BASE_URL}/api/ops/restart", headers=headers, json={"target": "server"}, timeout=15)
    assert r.status_code == 400, r.text
    assert "server operations" in r.text.lower() or "vps" in r.text.lower()


# --- project environment field ---
def test_project_environment_field(headers):
    # find an existing project or create one
    r = requests.get(f"{BASE_URL}/api/projects", headers=headers, timeout=15)
    assert r.status_code == 200
    projects = r.json()
    pid = None
    created = False
    if projects:
        pid = projects[0]["id"]
    else:
        payload = {
            "name": "TEST_env_project",
            "repo_url": "https://github.com/example/example.git",
            "branch": "main",
            "type": "static",
        }
        r = requests.post(f"{BASE_URL}/api/projects", headers=headers, json=payload, timeout=15)
        assert r.status_code in (200, 201), r.text
        pid = r.json()["id"]
        created = True

    try:
        # update environment
        r = requests.put(f"{BASE_URL}/api/projects/{pid}", headers=headers, json={"environment": "production"}, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("environment") == "production", f"got {body.get('environment')}"

        # GET
        r = requests.get(f"{BASE_URL}/api/projects/{pid}", headers=headers, timeout=15)
        assert r.status_code == 200
        assert r.json().get("environment") == "production"

        # public
        r = requests.get(f"{BASE_URL}/api/projects/{pid}/public", headers=headers, timeout=15)
        if r.status_code == 404:
            # alternate path
            r = requests.get(f"{BASE_URL}/api/projects/public/{pid}", headers=headers, timeout=15)
        # 'project_public' may be embedded in list endpoint
        if r.status_code == 200:
            data = r.json()
            assert "environment" in data, f"environment missing in public: {data}"
            assert data["environment"] == "production"
    finally:
        if created:
            requests.delete(f"{BASE_URL}/api/projects/{pid}", headers=headers, timeout=15)
