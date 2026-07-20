"""Backend tests for env var delivery to deployed apps (Nexus Panel bug fix)."""
import os
import time
from pathlib import Path

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://nexus-panel-2.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
APPS_DIR = Path("/opt/nexus-panel/apps")


@pytest.fixture(scope="session")
def token():
    r = requests.post(f"{API}/auth/login", json={"username": "superadmin", "password": "sa@4dm1n"})
    assert r.status_code == 200, r.text
    data = r.json()
    assert "access_token" in data
    return data["access_token"]


@pytest.fixture(scope="session")
def auth(token):
    return {"Authorization": f"Bearer {token}"}


# --- Auth ---
class TestAuth:
    def test_login_ok(self, token):
        assert isinstance(token, str) and len(token) > 20

    def test_root_api(self):
        r = requests.get(f"{API}/")
        assert r.status_code == 200


# --- Env delivery end-to-end via local repo ---
class TestEnvDelivery:
    def test_deploy_writes_env_files(self, auth):
        payload = {
            "name": "envtest2",
            "repo_url": "/tmp/testrepo",
            "branch": "main",
            "db_name": "envtest2_db",
            "env_vars": [
                {"key": "JWT_SECRET", "value": "supersecret123"},
                {"key": "EMERGENT_LLM_KEY", "value": "sk-abc"},
            ],
        }
        r = requests.post(f"{API}/projects", json=payload, headers=auth)
        assert r.status_code in (200, 201), r.text
        proj = r.json()
        pid = proj["id"]
        slug = proj["slug"]
        try:
            # trigger deploy
            r = requests.post(f"{API}/projects/{pid}/deploy", headers=auth)
            assert r.status_code in (200, 202), r.text
            # wait for artifacts to be written (deploy will fail later on docker step)
            time.sleep(6)

            app_dir = APPS_DIR / slug
            backend_env = app_dir / "backend" / ".env"
            compose = app_dir / "docker-compose.yml"

            assert backend_env.exists(), f"missing backend/.env at {backend_env}"
            env_content = backend_env.read_text()
            assert "JWT_SECRET=supersecret123" in env_content
            assert "EMERGENT_LLM_KEY=sk-abc" in env_content
            assert "MONGO_URL=" in env_content
            assert "DB_NAME=envtest2_db" in env_content
            assert "CORS_ORIGINS=" in env_content

            assert compose.exists(), f"missing docker-compose.yml at {compose}"
            comp = compose.read_text()
            assert "JWT_SECRET=supersecret123" in comp
            assert "EMERGENT_LLM_KEY=sk-abc" in comp
            assert "DB_NAME=envtest2_db" in comp
        finally:
            requests.delete(f"{API}/projects/{pid}", headers=auth)

    def test_project_update_persists_env_vars(self, auth):
        create_payload = {
            "name": "envpersist",
            "repo_url": "/tmp/testrepo",
            "branch": "main",
            "db_name": "envpersist_db",
            "env_vars": [],
        }
        r = requests.post(f"{API}/projects", json=create_payload, headers=auth)
        assert r.status_code in (200, 201), r.text
        pid = r.json()["id"]
        try:
            r = requests.put(
                f"{API}/projects/{pid}",
                json={"env_vars": [{"key": "JWT_SECRET", "value": "abc123"}]},
                headers=auth,
            )
            assert r.status_code == 200, r.text
            r = requests.get(f"{API}/projects/{pid}", headers=auth)
            assert r.status_code == 200
            data = r.json()
            keys = {e["key"]: e["value"] for e in data.get("env_vars", [])}
            assert keys.get("JWT_SECRET") == "abc123"
        finally:
            requests.delete(f"{API}/projects/{pid}", headers=auth)


# --- Regression ---
class TestRegression:
    def test_ssl_status_endpoint(self, auth):
        # need a project to test
        r = requests.post(
            f"{API}/projects",
            json={"name": "sslreg", "repo_url": "/tmp/testrepo", "branch": "main", "db_name": "sslreg_db"},
            headers=auth,
        )
        assert r.status_code in (200, 201)
        pid = r.json()["id"]
        try:
            r = requests.get(f"{API}/projects/{pid}/ssl-status", headers=auth)
            assert r.status_code == 200
            r = requests.get(f"{API}/system/containers-health", headers=auth)
            assert r.status_code == 200
        finally:
            d = requests.delete(f"{API}/projects/{pid}", headers=auth)
            assert d.status_code in (200, 204)

    def test_terminal_commands_list(self, auth):
        r = requests.get(f"{API}/terminal/commands", headers=auth)
        assert r.status_code == 200
