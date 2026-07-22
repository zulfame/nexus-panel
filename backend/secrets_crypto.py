"""Secret encryption at rest (Fernet), reusing the panel's PANEL_ENCRYPTION_KEY.

Values are stored with an `enc:v1:` prefix so we can tell an encrypted value apart from a
legacy plaintext one and migrate transparently. `decrypt_value` returns any non-prefixed input
unchanged, so the app keeps working before/after migration.
"""
import os

from cryptography.fernet import Fernet, InvalidToken

ENC_PREFIX = "enc:v1:"


def _fernet() -> Fernet:
    return Fernet(os.environ["PANEL_ENCRYPTION_KEY"].encode())


def encrypt_value(value: str) -> str:
    if value is None:
        return value
    if isinstance(value, str) and value.startswith(ENC_PREFIX):
        return value  # already encrypted
    return ENC_PREFIX + _fernet().encrypt(str(value).encode()).decode()


def decrypt_value(value):
    if not isinstance(value, str) or not value.startswith(ENC_PREFIX):
        return value  # legacy plaintext or non-string — pass through
    try:
        return _fernet().decrypt(value[len(ENC_PREFIX):].encode()).decode()
    except (InvalidToken, Exception):
        return value


def is_encrypted(value) -> bool:
    return isinstance(value, str) and value.startswith(ENC_PREFIX)


def encrypt_env_list(items):
    """Encrypt the `value` of each env var. Accepts list of dicts or objects with .key/.value."""
    out = []
    for e in items or []:
        if isinstance(e, dict):
            key, val = e.get("key"), e.get("value", "")
        else:
            key, val = getattr(e, "key", None), getattr(e, "value", "")
        out.append({"key": key, "value": encrypt_value(val or "")})
    return out


def decrypt_env_list(items):
    """Return list of {key, value(plaintext)} from possibly-encrypted stored env vars."""
    out = []
    for e in items or []:
        if isinstance(e, dict):
            key, val = e.get("key"), e.get("value", "")
        else:
            key, val = getattr(e, "key", None), getattr(e, "value", "")
        out.append({"key": key, "value": decrypt_value(val)})
    return out
