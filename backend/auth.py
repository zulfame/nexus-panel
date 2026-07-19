import os
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPBearer

from models import ChangePasswordRequest, LoginRequest

JWT_ALGORITHM = "HS256"
TOKEN_TTL_HOURS = 24 * 7

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


def create_access_token(username: str) -> str:
    payload = {
        "sub": username,
        "exp": datetime.now(timezone.utc) + timedelta(hours=TOKEN_TTL_HOURS),
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
        user = await db.users.find_one({"username": payload.get("sub")})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        user["_id"] = str(user["_id"])
        user.pop("password_hash", None)
        return user

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

    @router.post("/login")
    async def login(body: LoginRequest, request: Request):
        identifier = body.username.strip().lower()
        await _check_lockout(identifier)
        user = await db.users.find_one({"username": body.username})
        if not user or not verify_password(body.password, user.get("password_hash", "")):
            await _record_fail(identifier)
            raise HTTPException(status_code=401, detail="Invalid username or password")
        await _clear_attempts(identifier)
        token = create_access_token(body.username)
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
        return {"ok": True, "message": "Password updated"}

    return router, get_current_user
