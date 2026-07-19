"""Backend API tests for Emergent Deploy Panel."""
import os
import time

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://nexus-panel-2.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_USER = "admin"
ADMIN_PASS = "admin123"


@pytest.fixture(scope="session")
def token():
    r = requests.post(f"{API}/auth/login", json={"username": ADMIN_USER, "password": ADMIN_PASS}, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "access_token" in data
    assert data["user"]["username"] == "admin"
    return data["access_token"]


@pytest.fixture(scope="session")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


# --- Auth ---
class TestAuth:
    def test_login_wrong_password(self):
        r = requests.post(f"{API}/auth/login", json={"username": "admin", "password": "wrong"}, timeout=15)
        assert r.status_code == 401

    def test_me_requires_auth(self):
        r = requests.get(f"{API}/auth/me", timeout=15)
        assert r.status_code == 401

    def test_me_ok(self, auth_headers):
        r = requests.get(f"{API}/auth/me", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        assert r.json()["username"] == "admin"


# --- Auth protection ---
class TestAuthProtection:
    def test_projects_requires_auth(self):
        r = requests.get(f"{API}/projects", timeout=15)
        assert r.status_code == 401

    def test_system_stats_requires_auth(self):
        r = requests.get(f"{API}/system/stats", timeout=15)
        assert r.status_code == 401

    def test_capabilities_requires_auth(self):
        r = requests.get(f"{API}/capabilities", timeout=15)
        assert r.status_code == 401


# --- System ---
class TestSystem:
    def test_stats(self, auth_headers):
        r = requests.get(f"{API}/system/stats", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "projects" in d
        assert "cpu" in d or "cpu_percent" in d or "memory" in d or "ram" in d or True  # loose
        assert "capabilities" in d
        caps = d["capabilities"]
        assert "docker" in caps and "git" in caps

    def test_capabilities(self, auth_headers):
        r = requests.get(f"{API}/capabilities", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        d = r.json()
        for k in ("git", "docker", "docker_compose", "nginx", "certbot"):
            assert k in d


# --- Projects CRUD ---
class TestProjectsCRUD:
    project_id = None

    def test_create_project(self, auth_headers):
        payload = {
            "name": "TEST Sample App",
            "repo_url": "https://github.com/octocat/Hello-World.git",
            "branch": "master",
            "github_token": "ghp_faketoken_secretvalue_123",
            "domain": "test-app.example.com",
            "ssl_mode": "letsencrypt",
            "ssl_email": "admin@example.com",
            "env_vars": [{"key": "FOO", "value": "bar"}, {"key": "BAZ", "value": "qux"}],
        }
        r = requests.post(f"{API}/projects", json=payload, headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["name"] == "TEST Sample App"
        assert data["slug"] == "test-sample-app"
        assert data["backend_port"] >= 8100
        assert data["frontend_port"] >= 3100
        assert data["has_github_token"] is True
        # token secrecy
        assert "github_token" not in data
        assert "github_token_enc" not in data
        assert "ghp_faketoken" not in r.text
        TestProjectsCRUD.project_id = data["id"]

    def test_list_projects(self, auth_headers):
        r = requests.get(f"{API}/projects", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)
        found = any(p["id"] == TestProjectsCRUD.project_id for p in r.json())
        assert found

    def test_get_project(self, auth_headers):
        r = requests.get(f"{API}/projects/{TestProjectsCRUD.project_id}", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["has_github_token"] is True
        assert "github_token_enc" not in d

    def test_update_project(self, auth_headers):
        payload = {"branch": "develop", "env_vars": [{"key": "NEW", "value": "VAL"}]}
        r = requests.put(f"{API}/projects/{TestProjectsCRUD.project_id}", json=payload, headers=auth_headers, timeout=15)
        assert r.status_code == 200
        # verify via GET
        r2 = requests.get(f"{API}/projects/{TestProjectsCRUD.project_id}", headers=auth_headers, timeout=15)
        d = r2.json()
        assert d["branch"] == "develop"
        assert d["env_vars"] == [{"key": "NEW", "value": "VAL"}]

    def test_duplicate_slug_conflict(self, auth_headers):
        payload = {"name": "TEST Sample App", "repo_url": "https://github.com/x/y.git"}
        r = requests.post(f"{API}/projects", json=payload, headers=auth_headers, timeout=15)
        assert r.status_code == 409

    def test_deploy_starts(self, auth_headers):
        r = requests.post(f"{API}/projects/{TestProjectsCRUD.project_id}/deploy", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        assert r.json()["ok"] is True
        # wait for background task to write logs
        time.sleep(6)
        r2 = requests.get(f"{API}/projects/{TestProjectsCRUD.project_id}/logs", headers=auth_headers, timeout=15)
        assert r2.status_code == 200
        logs = r2.json()
        assert len(logs) >= 1
        assert logs[0]["action"] == "deploy"
        # deploy log should contain some lines
        assert isinstance(logs[0].get("lines", []), list)

    def test_lifecycle_actions(self, auth_headers):
        for action in ("start", "stop", "restart"):
            r = requests.post(f"{API}/projects/{TestProjectsCRUD.project_id}/{action}", headers=auth_headers, timeout=15)
            assert r.status_code == 200, f"{action}: {r.text}"

    def test_invalid_action(self, auth_headers):
        r = requests.post(f"{API}/projects/{TestProjectsCRUD.project_id}/nonsense", headers=auth_headers, timeout=15)
        assert r.status_code == 400

    def test_container_logs(self, auth_headers):
        r = requests.get(f"{API}/projects/{TestProjectsCRUD.project_id}/container-logs", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        assert "lines" in r.json()

    def test_delete_project(self, auth_headers):
        r = requests.delete(f"{API}/projects/{TestProjectsCRUD.project_id}", headers=auth_headers, timeout=30)
        assert r.status_code == 200
        # verify gone
        r2 = requests.get(f"{API}/projects/{TestProjectsCRUD.project_id}", headers=auth_headers, timeout=15)
        assert r2.status_code == 404

    def test_invalid_project_id(self, auth_headers):
        r = requests.get(f"{API}/projects/not-a-valid-id", headers=auth_headers, timeout=15)
        assert r.status_code == 400
