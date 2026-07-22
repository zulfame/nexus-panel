"""Phase 3-5 regression tests: docs, audit verify/export, metrics range, terminal pagination, projects CRUD."""
import os
import io
import csv
import json
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://nexus-panel-2.preview.emergentagent.com").rstrip("/")
ADMIN = {"username": "superadmin", "password": "sa@4dm1n"}


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


# --- Swagger / OpenAPI ---
def test_docs_swagger_ui():
    r = requests.get(f"{BASE_URL}/api/docs", timeout=30)
    assert r.status_code == 200
    assert "swagger" in r.text.lower() or "openapi" in r.text.lower()


def test_openapi_json_title():
    r = requests.get(f"{BASE_URL}/api/openapi.json", timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert data.get("info", {}).get("title") == "Nexus Panel API"


# --- Audit verify ---
def test_audit_verify_ok(auth_headers):
    r = requests.get(f"{BASE_URL}/api/audit/verify", headers=auth_headers, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("ok") is True, f"verify not ok: {data}"
    assert data.get("broken_at") in (None, "null")
    assert "checked" in data
    assert isinstance(data["checked"], int)


# --- Audit export JSON ---
def test_audit_export_json(auth_headers):
    r = requests.get(f"{BASE_URL}/api/audit/export", headers=auth_headers, params={"format": "json"}, timeout=30)
    assert r.status_code == 200
    assert "application/json" in r.headers.get("content-type", "").lower()
    # Attachment
    cd = r.headers.get("content-disposition", "")
    assert "attachment" in cd.lower(), f"expected attachment, got: {cd}"
    data = r.json()
    assert isinstance(data, list)
    if data:
        rec = data[0]
        for f in ["ts", "actor", "action", "hash", "seq", "prev_hash"]:
            assert f in rec, f"missing field {f} in {rec}"


# --- Audit export CSV ---
def test_audit_export_csv(auth_headers):
    r = requests.get(f"{BASE_URL}/api/audit/export", headers=auth_headers, params={"format": "csv"}, timeout=30)
    assert r.status_code == 200
    assert "text/csv" in r.headers.get("content-type", "").lower()
    reader = csv.reader(io.StringIO(r.text))
    header = next(reader)
    assert header == ["ts", "actor", "action", "target", "seq", "hash", "prev_hash", "meta"], f"header={header}"


# --- Metrics range ---
def test_metrics_large_range(auth_headers):
    # Need a project id — fetch or create one
    pr = requests.get(f"{BASE_URL}/api/projects", headers=auth_headers, timeout=30)
    assert pr.status_code == 200
    projects = pr.json()
    if isinstance(projects, dict):
        projects = projects.get("items", [])
    if not projects:
        # create ephemeral
        cr = requests.post(f"{BASE_URL}/api/projects", headers=auth_headers, json={
            "name": "TEST_metrics_proj",
            "repo_url": "https://github.com/octocat/Hello-World.git",
            "branch": "master",
        }, timeout=30)
        assert cr.status_code in (200, 201), cr.text
        pid = cr.json()["id"]
    else:
        pid = projects[0]["id"]
    r = requests.get(f"{BASE_URL}/api/projects/{pid}/metrics", headers=auth_headers, params={"minutes": 4320}, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "points" in data
    assert isinstance(data["points"], list)


# --- Terminal recordings shape ---
def test_terminal_recordings_shape(auth_headers):
    r = requests.get(f"{BASE_URL}/api/terminal/recordings", headers=auth_headers, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data, dict), f"expected object, got {type(data)}"
    for k in ["items", "total", "limit", "skip"]:
        assert k in data, f"missing key {k} in {data.keys()}"
    assert isinstance(data["items"], list)


# --- Projects CRUD regression ---
def test_projects_crud(auth_headers):
    lst = requests.get(f"{BASE_URL}/api/projects", headers=auth_headers, timeout=30)
    assert lst.status_code == 200
    payload = {
        "name": "TEST_regression_proj",
        "repo_url": "https://github.com/octocat/Hello-World.git",
        "branch": "master",
    }
    cr = requests.post(f"{BASE_URL}/api/projects", headers=auth_headers, json=payload, timeout=30)
    assert cr.status_code in (200, 201), cr.text
    pid = cr.json()["id"]
    try:
        rd = requests.get(f"{BASE_URL}/api/projects/{pid}", headers=auth_headers, timeout=30)
        assert rd.status_code == 200
        assert rd.json()["id"] == pid
    finally:
        dl = requests.delete(f"{BASE_URL}/api/projects/{pid}", headers=auth_headers, timeout=30)
        assert dl.status_code in (200, 204)
