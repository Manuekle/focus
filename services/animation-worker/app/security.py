"""Service-token auth and callback URL checks."""

from __future__ import annotations

import hmac
from urllib.parse import urlsplit

from fastapi import Header, HTTPException

from .config import settings


def require_token(authorization: str = Header(default="")) -> None:
    """Every /internal route needs the shared service token. Constant-time compare."""
    expected = settings.token
    given = authorization.removeprefix("Bearer ").strip()
    if len(expected) < 24 or not hmac.compare_digest(given.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="unauthorized")


class UnsafeUrl(ValueError):
    pass


def check_callback_url(url: str) -> str:
    """Only Focus's own signed URLs: an allowed host, https (http only when explicitly enabled), no credentials."""
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    if parts.username or parts.password:
        raise UnsafeUrl("credentials in URL")
    if host not in settings.allowed_hosts:
        raise UnsafeUrl(f"host not allowed: {host}")
    if parts.scheme != "https" and not (parts.scheme == "http" and settings.allow_insecure):
        raise UnsafeUrl(f"scheme not allowed: {parts.scheme}")
    if not parts.path.startswith("/api/animations/worker/"):
        raise UnsafeUrl("unexpected path")
    return url
