"""Auth helpers: bcrypt password hashing, JWT, and a simple in-memory
rate limiter for auth endpoints (per-process; use Redis/a gateway limiter
in a multi-instance production deployment)."""
import datetime as dt
import os
import threading
import time

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .database import get_db
from .models import User

JWT_SECRET = os.environ.get("JWT_SECRET", "dev-only-insecure-secret-change-me")
JWT_EXPIRE_DAYS = int(os.environ.get("JWT_EXPIRE_DAYS", "7"))
ALGORITHM = "HS256"

_bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8")[:72], bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8")[:72], password_hash.encode("utf-8"))
    except Exception:
        return False


def create_token(user: User) -> str:
    payload = {
        "sub": str(user.id),
        "email": user.email,
        "exp": dt.datetime.utcnow() + dt.timedelta(days=JWT_EXPIRE_DAYS),
        "iat": dt.datetime.utcnow(),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=ALGORITHM)


def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    if creds is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[ALGORITHM])
        user_id = int(payload["sub"])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="User no longer exists")
    return user


class RateLimiter:
    """Fixed-window in-memory limiter keyed by client IP + bucket name."""

    def __init__(self, limit: int, window_seconds: int):
        self.limit = limit
        self.window = window_seconds
        self._hits: dict = {}
        self._lock = threading.Lock()

    def check(self, key: str):
        now = time.time()
        with self._lock:
            bucket = self._hits.get(key, [])
            bucket = [t for t in bucket if now - t < self.window]
            if len(bucket) >= self.limit:
                raise HTTPException(
                    status_code=429,
                    detail="Too many attempts. Please wait a minute and try again.",
                )
            bucket.append(now)
            self._hits[key] = bucket


auth_limiter = RateLimiter(limit=30, window_seconds=60)


def limit_auth(request: Request):
    ip = request.client.host if request.client else "unknown"
    auth_limiter.check(f"auth:{ip}")
