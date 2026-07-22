import asyncio
import hashlib
import json
from datetime import datetime, timezone

_lock = asyncio.Lock()


def _entry_hash(prev_hash: str, payload: dict) -> str:
    body = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256((prev_hash + body).encode("utf-8")).hexdigest()


async def log_event(db, actor, action, target="", meta=None):
    """Fire-and-forget, tamper-evident audit record. Each entry is chained to the previous one
    via a SHA-256 hash (prev_hash + entry), so any later modification/deletion breaks the chain.
    Never raises."""
    try:
        async with _lock:
            last = await db.audit_logs.find_one(sort=[("seq", -1)])
            seq = (last.get("seq", 0) + 1) if last else 1
            prev_hash = last.get("hash", "") if last else ""
            payload = {
                "ts": datetime.now(timezone.utc).isoformat(),
                "actor": actor or "system",
                "action": action,
                "target": target or "",
                "meta": meta or {},
                "seq": seq,
                "prev_hash": prev_hash,
            }
            payload["hash"] = _entry_hash(prev_hash, payload)
            await db.audit_logs.insert_one(payload)
    except Exception:
        pass


async def verify_chain(db) -> dict:
    """Recompute the hash chain over all stored audit records. Returns integrity status."""
    checked = 0
    prev_hash = None
    broken_at = None
    async for d in db.audit_logs.find({}).sort("seq", 1):
        d.pop("_id", None)
        stored_hash = d.get("hash")
        stored_prev = d.get("prev_hash", "")
        if stored_hash is None or "seq" not in d:
            continue  # legacy record predating the chain — skip
        if prev_hash is not None and stored_prev != prev_hash:
            broken_at = d.get("seq")
            break
        payload = {k: d[k] for k in ("ts", "actor", "action", "target", "meta", "seq", "prev_hash") if k in d}
        if _entry_hash(stored_prev, payload) != stored_hash:
            broken_at = d.get("seq")
            break
        prev_hash = stored_hash
        checked += 1
    return {"ok": broken_at is None, "checked": checked, "broken_at": broken_at}
