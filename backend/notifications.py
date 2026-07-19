import os

import requests


def telegram_configured() -> bool:
    return bool(os.environ.get("TELEGRAM_BOT_TOKEN") and os.environ.get("TELEGRAM_CHAT_ID"))


def send_telegram(text: str) -> bool:
    """Send an HTML message to the configured Telegram chat/topic.
    No-op (returns False) if env vars are not set. Never raises."""
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat = os.environ.get("TELEGRAM_CHAT_ID")
    thread = os.environ.get("TELEGRAM_THREAD_ID")
    if not token or not chat:
        return False
    payload = {
        "chat_id": chat,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }
    if thread:
        try:
            payload["message_thread_id"] = int(thread)
        except ValueError:
            pass
    try:
        r = requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json=payload,
            timeout=10,
        )
        return r.ok
    except Exception:
        return False
