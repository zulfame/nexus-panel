"""Backend unit tests — pure functions, no running server or DB required.

Covers: secret encryption at rest, audit hash-chain verification, disk guard,
JSON restore shape detection/parsing, and committed-secret scanning.
"""
import os
import sys
import tempfile
from pathlib import Path

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test")
os.environ.setdefault("JWT_SECRET", "test-secret")
# Deterministic Fernet key for encryption tests.
os.environ.setdefault("PANEL_ENCRYPTION_KEY", "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef0=")


# ---------------------------------------------------------------- secrets ----
def test_encrypt_roundtrip_and_prefix():
    from secrets_crypto import encrypt_value, decrypt_value, is_encrypted
    enc = encrypt_value("super-secret")
    assert enc.startswith("enc:v1:")
    assert is_encrypted(enc)
    assert decrypt_value(enc) == "super-secret"


def test_encrypt_idempotent_and_plaintext_passthrough():
    from secrets_crypto import encrypt_value, decrypt_value
    enc = encrypt_value("abc")
    assert encrypt_value(enc) == enc            # already-encrypted stays put
    assert decrypt_value("legacy-plaintext") == "legacy-plaintext"


def test_encrypt_env_list():
    from secrets_crypto import encrypt_env_list, decrypt_env_list, is_encrypted
    items = [{"key": "A", "value": "1"}, {"key": "B", "value": "2"}]
    enc = encrypt_env_list(items)
    assert all(is_encrypted(e["value"]) for e in enc)
    dec = decrypt_env_list(enc)
    assert {e["key"]: e["value"] for e in dec} == {"A": "1", "B": "2"}


# --------------------------------------------------------------- disk guard --
def test_disk_guard_ok_and_block():
    from system_stats import disk_guard
    ok, _s, lim = disk_guard("/")
    assert isinstance(ok, bool) and "free_mb" in lim
    os.environ["DISK_GUARD_MIN_FREE_MB"] = "999999999999"
    try:
        blocked, _s2, _lim2 = disk_guard("/")
        assert blocked is False
    finally:
        os.environ.pop("DISK_GUARD_MIN_FREE_MB")


# --------------------------------------------------------------- audit chain -
@pytest.mark.asyncio
async def test_audit_hash_chain_verifies_and_detects_tamper():
    import audit

    class FakeCursor:
        def __init__(self, docs): self._docs = docs
        def sort(self, *a, **k): return self
        def __aiter__(self):
            async def gen():
                for d in self._docs:
                    yield d
            return gen()

    class FakeColl:
        def __init__(self): self.docs = []
        def find_one(self, *a, **k):
            async def f():
                return self.docs[-1] if self.docs else None
            return f()
        async def insert_one(self, d): self.docs.append(dict(d))
        def find(self, *a, **k): return FakeCursor(list(self.docs))

    class FakeDB:
        def __init__(self): self.audit_logs = FakeColl()

    db = FakeDB()
    await audit.log_event(db, "alice", "login")
    await audit.log_event(db, "bob", "deploy", "proj-1")
    res = await audit.verify_chain(db)
    assert res["ok"] is True and res["checked"] == 2 and res["broken_at"] is None
    # tamper with an entry → chain must break
    db.audit_logs.docs[0]["actor"] = "mallory"
    res2 = await audit.verify_chain(db)
    assert res2["ok"] is False and res2["broken_at"] is not None


# -------------------------------------------------------- json shape/parse ---
def _mgr():
    import db_manager as m
    return m.DBManager.__new__(m.DBManager)


def _w(d, name, obj):
    import json
    p = Path(d) / name
    p.write_text(json.dumps(obj) if not isinstance(obj, str) else obj)
    return p


def test_json_classify_shapes():
    import json
    mgr = _mgr()
    d = tempfile.mkdtemp()
    assert mgr._classify_json(_w(d, "a__x.json", [{"a": 1}])) == "array"
    assert mgr._classify_json(_w(d, "b__x.json", "\n".join(json.dumps({"i": i}) for i in range(3)))) == "ndjson"
    assert mgr._classify_json(_w(d, "c__x.json", {"only": True})) == "single"
    assert mgr._classify_json(_w(d, "d__x.json", {"users": [{"u": 1}], "orders": [{"o": 1}]})) == "multi"
    assert mgr._classify_json(_w(d, "e__x.json", "[]")) == "empty"


def test_json_inmem_parse_handles_wrapped_and_metadata():
    mgr = _mgr()
    d = tempfile.mkdtemp()
    # metadata-prefixed object of arrays (the bug from v1.7.1)
    r1 = mgr._parse_json_collections_inmem(_w(d, "m__x.json", {"exported_at": "x", "users": [{"u": 1}], "orders": [{"o": 1}, {"o": 2}]}))
    assert {k: len(v) for k, v in r1.items()} == {"users": 1, "orders": 2}
    # wrapped {"collections": {...}}
    r2 = mgr._parse_json_collections_inmem(_w(d, "w__x.json", {"metadata": {}, "collections": {"a": [{"x": 1}], "b": []}}))
    assert r2["a"] == [{"x": 1}] and r2["b"] == []
    # single doc → named after file
    r3 = mgr._parse_json_collections_inmem(_w(d, "s__coll.json", {"_id": 1}))
    assert r3 == {"coll": [{"_id": 1}]}


# ---------------------------------------------------- committed secret scan --
def test_scan_committed_secrets_detects_and_skips_placeholders():
    from deploy_engine import DeployEngine
    eng = DeployEngine.__new__(DeployEngine)
    d = Path(tempfile.mkdtemp())
    (d / "app.py").write_text('AWS_KEY = "AKIA1234567890ABCDEF"\nprivate = "-----BEGIN PRIVATE KEY-----"\n')
    (d / ".env").write_text('API_KEY="your-api-key-here"\nDB="mongodb://user:realpass@host/db"\n')
    (d / "node_modules").mkdir()
    (d / "node_modules" / "junk.js").write_text('token="sk_live_1234567890abcdef"')
    findings = eng._scan_committed_secrets(d)
    types = {f["type"] for f in findings}
    assert "AWS access key" in types
    assert "Private key" in types
    assert "DB URI with password" in types
    # placeholder api key skipped, and node_modules skipped
    assert not any("node_modules" in f["file"] for f in findings)


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
