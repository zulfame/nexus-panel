from datetime import datetime, timezone


async def log_event(db, actor, action, target="", meta=None):
    """Fire-and-forget audit record. Never raises."""
    try:
        await db.audit_logs.insert_one({
            "ts": datetime.now(timezone.utc).isoformat(),
            "actor": actor or "system",
            "action": action,
            "target": target or "",
            "meta": meta or {},
        })
    except Exception:
        pass
