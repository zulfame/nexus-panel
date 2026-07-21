"""Iteration 23 backend tests: Domain Health endpoints."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fallback via frontend/.env
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.strip().split("=", 1)[1].strip().rstrip("/")


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": "superadmin", "password": "sa@4dm1n"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def project(headers):
    r = requests.get(f"{BASE_URL}/api/projects", headers=headers, timeout=10)
    assert r.status_code == 200
    projects = r.json()
    assert len(projects) >= 1, "expected at least one project (TEST_uienv)"
    return projects[0]


# --- /api/system/domains-health ---
def test_system_domains_health_map(headers, project):
    r = requests.get(f"{BASE_URL}/api/system/domains-health", headers=headers, timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data, dict)
    pid = project["id"]
    assert pid in data
    entry = data[pid]
    # shape assertions
    for key in ("domain", "reachable", "status", "scheme", "latency_ms", "error"):
        assert key in entry, f"missing key {key} in {entry}"
    # no-domain case
    if not (project.get("domain") or "").strip():
        assert entry["reachable"] is None
        assert entry["error"] == "no domain"


# --- /api/projects/{id}/domain-health single ---
def test_project_domain_health_no_domain(headers, project):
    original_domain = project.get("domain") or ""
    if original_domain.strip():
        pytest.skip("project already has a domain; skipping no-domain assertion")
    r = requests.get(f"{BASE_URL}/api/projects/{project['id']}/domain-health", headers=headers, timeout=10)
    assert r.status_code == 200
    data = r.json()
    assert data["reachable"] is None
    assert data["error"] == "no domain"
    assert data["domain"] is None


def test_project_domain_health_reachable_example_com(headers, project):
    """Temporarily set domain=example.com and verify reachable=true; then revert."""
    original_domain = project.get("domain") or ""
    pid = project["id"]
    try:
        r = requests.put(f"{BASE_URL}/api/projects/{pid}", headers=headers, json={"domain": "example.com"}, timeout=15)
        assert r.status_code == 200, r.text
        assert (r.json().get("domain") or "").lower() == "example.com"

        r2 = requests.get(f"{BASE_URL}/api/projects/{pid}/domain-health", headers=headers, timeout=15)
        assert r2.status_code == 200, r2.text
        data = r2.json()
        assert data["domain"] == "example.com"
        assert data["reachable"] is True, f"expected reachable=true, got {data}"
        assert data["status"] == 200
        assert data["scheme"] in ("https", "http")
        assert isinstance(data["latency_ms"], int)
        assert data["error"] is None

        # And it should appear in the system map with same shape
        r3 = requests.get(f"{BASE_URL}/api/system/domains-health", headers=headers, timeout=20)
        assert r3.status_code == 200
        agg = r3.json()
        assert agg[pid]["reachable"] is True
        assert agg[pid]["status"] == 200
    finally:
        # revert
        rev = requests.put(f"{BASE_URL}/api/projects/{pid}", headers=headers, json={"domain": original_domain}, timeout=15)
        assert rev.status_code == 200, rev.text
