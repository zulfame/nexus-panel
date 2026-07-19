import os
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPBearer

from models import LoginRequest

JWT_ALGORITHM = "HS256"
TOKEN_TTL_HOURS = 24 * 7

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
    username = os.environ.get("ADMIN_USERNAME", "admin")
    password = os.environ.get("ADMIN_PASSWORD", "admin123")
    existing = await db.users.find_one({"username": username})
    if existing is None:
        await db.users.insert_one(
            {
                "username": username,
                "password_hash": hash_password(password),
                "role": "admin",
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        )
    elif not verify_password(password, existing.get("password_hash", "")):
        await db.users.update_one(
            {"username": username},
            {"$set": {"password_hash": hash_password(password)}},
        )


def build_auth_router(db) -> APIRouter:
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

    @router.post("/login")
    async def login(body: LoginRequest):
        user = await db.users.find_one({"username": body.username})
        if not user or not verify_password(body.password, user.get("password_hash", "")):
            raise HTTPException(status_code=401, detail="Invalid username or password")
        token = create_access_token(body.username)
        return {
            "access_token": token,
            "token_type": "bearer",
            "user": {"username": user["username"], "role": user.get("role", "admin")},
        }

    @router.get("/me")
    async def me(current=Depends(get_current_user)):
        return {"username": current["username"], "role": current.get("role", "admin")}

    return router, get_current_user
