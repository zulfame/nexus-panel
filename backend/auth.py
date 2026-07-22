import os
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPBearer

from models import ChangePasswordRequest, CreateUserRequest, LoginRequest
from audit import log_event

JWT_ALGORITHM = "HS256"
TOKEN_TTL_HOURS = 12
REMEMBER_TTL_HOURS = 24 * 30

MAX_ATTEMPTS = 5
LOCK_MINUTES = 15

security = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def get_jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


def create_access_token(username: str, remember: bool = False) -> str:
    ttl = REMEMBER_TTL_HOURS if remember else TOKEN_TTL_HOURS
    now = datetime.now(timezone.utc)
    payload = {
        "sub": username,
        "iat": int(now.timestamp()),
        "exp": now + timedelta(hours=ttl),
        "jti": uuid.uuid4().hex,
        "type": "access",
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


async def seed_admin(db):
    """Create default admin only if it does not exist, so a user-changed
    password persists across restarts."""
    username = os.environ.get("ADMIN_USERNAME", "admin")
    password = os.environ.get("ADMIN_PASSWORD", "admin123")
    email = os.environ.get("ADMIN_EMAIL")
    existing = await db.users.find_one({"username": username})
    if existing is None:
        await db.users.insert_one(
            {
                "username": username,
                "email": email,
                "password_hash": hash_password(password),
                "role": "admin",
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        )
    elif existing.get("email") != email:
        await db.users.update_one(
            {"username": username}, {"$set": {"email": email}}
        )


def build_auth_router(db):
    router = APIRouter(prefix="/auth", tags=["auth"])

    async def get_current_user(request: Request) -> dict:
        auth_header = request.headers.get("Authorization", "")
        token = auth_header[7:] if auth_header.startswith("Bearer ") else None
        if not token:
            raise HTTPException(status_code=401, detail="Not authenticated")
        try:
            payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        except jwt.ExpiredSignatureError:
            raise HTTPException(status_code=401, detail="Token expired")
        except jwt.InvalidTokenError:
            raise HTTPException(status_code=401, detail="Invalid token")
        # Session revocation: single-token logout (jti blacklist) and "logout everywhere"
        # (tokens issued before the user's token_epoch are rejected).
        jti = payload.get("jti")
        if jti and await db.revoked_tokens.find_one({"jti": jti}):
            raise HTTPException(status_code=401, detail="Session was revoked. Please sign in again.")
        user = await db.users.find_one({"username": payload.get("sub")})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        epoch = user.get("token_epoch")
        iat = payload.get("iat")
        if epoch and iat and iat < epoch:
            raise HTTPException(status_code=401, detail="Session expired. Please sign in again.")
        user["_id"] = str(user["_id"])
        user.pop("password_hash", None)
        user["_token"] = {"jti": jti, "exp": payload.get("exp")}
        return user

    async def _revoke_token(payload_token: dict):
        jti = payload_token.get("jti")
        exp = payload_token.get("exp")
        if not jti:
            return
        expires_at = datetime.fromtimestamp(exp, tz=timezone.utc) if exp else (
            datetime.now(timezone.utc) + timedelta(hours=REMEMBER_TTL_HOURS)
        )
        await db.revoked_tokens.update_one(
            {"jti": jti}, {"$set": {"jti": jti, "expires_at": expires_at}}, upsert=True
        )

    async def _check_lockout(identifier: str):
        rec = await db.login_attempts.find_one({"identifier": identifier})
        if rec and rec.get("locked_until"):
            locked_until = datetime.fromisoformat(rec["locked_until"])
            if locked_until > datetime.now(timezone.utc):
                remaining = int((locked_until - datetime.now(timezone.utc)).total_seconds() // 60) + 1
                raise HTTPException(
                    status_code=429,
                    detail=f"Too many failed attempts. Try again in {remaining} minute(s).",
                )

    async def _record_fail(identifier: str):
        rec = await db.login_attempts.find_one({"identifier": identifier})
        count = (rec.get("count", 0) if rec else 0) + 1
        update = {"count": count, "last_attempt": datetime.now(timezone.utc).isoformat()}
        if count >= MAX_ATTEMPTS:
            update["locked_until"] = (
                datetime.now(timezone.utc) + timedelta(minutes=LOCK_MINUTES)
            ).isoformat()
            update["count"] = 0
        await db.login_attempts.update_one(
            {"identifier": identifier}, {"$set": update}, upsert=True
        )

    async def _clear_attempts(identifier: str):
        await db.login_attempts.delete_one({"identifier": identifier})

    def _client_ip(request: Request) -> str:
        xff = request.headers.get("X-Forwarded-For", "")
        if xff:
            return xff.split(",")[0].strip()
        return request.client.host if request.client else "unknown"

    @router.post("/login")
    async def login(body: LoginRequest, request: Request):
        # Rate-limit brute force per (IP + username) so one attacker IP can't grind an account
        # and a distributed attack still can't lock a legit user out from their own IP forever.
        uname = body.username.strip().lower()
        identifier = f"{_client_ip(request)}:{uname}"
        await _check_lockout(identifier)
        user = await db.users.find_one({"username": body.username})
        if not user or not verify_password(body.password, user.get("password_hash", "")):
            await _record_fail(identifier)
            raise HTTPException(status_code=401, detail="Invalid username or password")
        await _clear_attempts(identifier)
        token = create_access_token(body.username, remember=body.remember)
        await log_event(db, user["username"], "auth.login")
        return {
            "access_token": token,
            "token_type": "bearer",
            "user": {
                "username": user["username"],
                "email": user.get("email"),
                "role": user.get("role", "admin"),
            },
        }

    @router.get("/me")
    async def me(current=Depends(get_current_user)):
        return {
            "username": current["username"],
            "email": current.get("email"),
            "role": current.get("role", "admin"),
        }

    @router.post("/logout")
    async def logout(current=Depends(get_current_user)):
        """Revoke the current access token (this device/session only)."""
        await _revoke_token(current.get("_token") or {})
        await log_event(db, current["username"], "auth.logout")
        return {"ok": True, "message": "Signed out"}

    @router.post("/logout-all")
    async def logout_all(current=Depends(get_current_user)):
        """Invalidate every existing session for this user (all devices)."""
        now_ts = int(datetime.now(timezone.utc).timestamp()) + 1
        await db.users.update_one(
            {"username": current["username"]}, {"$set": {"token_epoch": now_ts}}
        )
        await log_event(db, current["username"], "auth.logout_all")
        return {"ok": True, "message": "Signed out of all devices"}

    @router.post("/change-password")
    async def change_password(body: ChangePasswordRequest, current=Depends(get_current_user)):
        if len(body.new_password) < 6:
            raise HTTPException(status_code=400, detail="New password must be at least 6 characters")
        user = await db.users.find_one({"username": current["username"]})
        if not user or not verify_password(body.current_password, user.get("password_hash", "")):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
        await db.users.update_one(
            {"username": current["username"]},
            {"$set": {"password_hash": hash_password(body.new_password)}},
        )
        await log_event(db, current["username"], "auth.change_password")
        return {"ok": True, "message": "Password updated"}

    @router.get("/users")
    async def list_users(current=Depends(get_current_user)):
        seed = os.environ.get("ADMIN_USERNAME", "admin")
        out = []
        async for u in db.users.find().sort("created_at", 1):
            out.append({
                "username": u["username"],
                "email": u.get("email"),
                "created_at": u.get("created_at"),
                "is_seed": u["username"] == seed,
            })
        return out

    @router.post("/users")
    async def create_user(body: CreateUserRequest, current=Depends(get_current_user)):
        username = body.username.strip()
        if len(username) < 3:
            raise HTTPException(status_code=400, detail="Username must be at least 3 characters")
        if len(body.password) < 6:
            raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
        if await db.users.find_one({"username": username}):
            raise HTTPException(status_code=409, detail=f"User '{username}' already exists")
        await db.users.insert_one({
            "username": username,
            "email": (body.email or "").strip() or None,
            "password_hash": hash_password(body.password),
            "role": "admin",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        await log_event(db, current["username"], "user.create", target=username)
        return {"ok": True, "username": username}

    @router.delete("/users/{username}")
    async def delete_user(username: str, current=Depends(get_current_user)):
        if username == current["username"]:
            raise HTTPException(status_code=400, detail="You cannot delete your own account")
        seed = os.environ.get("ADMIN_USERNAME", "admin")
        if username == seed:
            raise HTTPException(status_code=400, detail="The seeded admin account cannot be deleted")
        if not await db.users.find_one({"username": username}):
            raise HTTPException(status_code=404, detail="User not found")
        if await db.users.count_documents({}) <= 1:
            raise HTTPException(status_code=400, detail="Cannot delete the last remaining user")
        await db.users.delete_one({"username": username})
        await log_event(db, current["username"], "user.delete", target=username)
        return {"ok": True}

    return router, get_current_user
