# SPDX-License-Identifier: MIT
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select

from .config import settings
from .db import SessionLocal
from .models import User, now
from .deps import COOKIE, same_origin
from .routers import admin, auth, contact, moderation, presets, profile, projects, registry, social, library, tokens, user_tokens
from .security import hash_password


def ensure_admin() -> None:
    """Create the first admin from BLEEP_ADMIN_EMAIL / BLEEP_ADMIN_PASSWORD; never touches an existing user."""
    if not (settings.admin_email and settings.admin_password):
        return
    email = settings.admin_email.lower()
    with SessionLocal() as db:
        if db.scalar(select(User).where(User.email == email)) is None:
            db.add(User(email=email, password_hash=hash_password(settings.admin_password),
                        display_name="Admin", role="admin", email_verified_at=now()))
            db.commit()


def refuse_placeholder_secrets() -> None:
    """A production start (secure cookies) with a secret copied from .env.example ("change-me...") stops instead of running with it."""
    if not settings.cookie_secure:
        return  # local development
    from sqlalchemy.engine import make_url

    try:
        db_password = make_url(settings.database_url).password or ""
    except Exception:
        db_password = ""
    values = {"BLEEP_ADMIN_PASSWORD": settings.admin_password or "", "BLEEP_S3_SECRET_KEY": settings.s3_secret_key, "the database password": db_password}
    bad = [name for name, value in values.items() if value.lower().startswith("change-me")]
    if bad:
        raise RuntimeError("Refusing to start: " + ", ".join(bad) + " still has the placeholder value from .env.example. Set a real secret "
                           "(or BLEEP_COOKIE_SECURE=false for local development).")


@asynccontextmanager
async def lifespan(_: FastAPI):
    refuse_placeholder_secrets()
    ensure_admin()
    yield


app = FastAPI(title="Beautiful Bleep API", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


MAX_BODY = 1024 * 1024  # JSON bodies (presets are capped at 512 KB inside, the rest is far smaller)
MAX_IMAGE_BODY = 2 * 1024 * 1024
MAX_UPLOAD = 1024 * 1024 * 1024 + 1024 * 1024  # store files: the registry's own limit (MAX_FILE_BYTES) plus a little


def body_limit(path: str) -> int:
    if path.startswith("/api/registry/"):
        if "/files/" in path:
            return MAX_UPLOAD
        if path.endswith("/image"):
            return MAX_IMAGE_BODY
    return MAX_BODY


class LimitBody:
    """ASGI middleware: answers 413 when a request body is larger than the limit for its path, before the app parses it.

    A declared Content-Length is checked up front; a body without one (chunked) is counted while it streams."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope["path"].startswith("/api/"):
            return await self.app(scope, receive, send)
        limit = body_limit(scope["path"])
        declared = dict(scope["headers"]).get(b"content-length")
        too_big = False
        if declared is not None:
            try:
                too_big = int(declared) > limit
            except ValueError:
                too_big = True
        if too_big:
            return await self._refuse(scope, receive, send)
        seen, started, refused = 0, False, False

        async def counted():
            nonlocal seen, refused
            if refused:
                return {"type": "http.disconnect"}
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > limit:  # the app would turn an exception here into a 400, so answer now and let it see a disconnect
                    refused = True
                    if not started:
                        await self._refuse(scope, receive, send)
                    return {"type": "http.disconnect"}
            return message

        async def tracked_send(message):
            nonlocal started
            if refused:  # whatever the app answers after the refusal is dropped
                return
            started = started or message["type"] == "http.response.start"
            await send(message)

        await self.app(scope, counted, tracked_send)

    @staticmethod
    async def _refuse(scope, receive, send):
        await JSONResponse({"detail": "Request body too large"}, status_code=413, headers={"Connection": "close"})(scope, receive, send)


app.add_middleware(LimitBody)


@app.middleware("http")
async def refuse_cross_site_writes(request: Request, call_next):
    """CSRF: the session cookie is SameSite=Lax; on top of that a write that carries it must come from this site."""
    if request.method not in ("GET", "HEAD", "OPTIONS") and COOKIE in request.cookies and not same_origin(request):
        return JSONResponse({"detail": "Cross-site request refused"}, status_code=403)
    return await call_next(request)


app.include_router(auth.router)
app.include_router(contact.router)
app.include_router(profile.router)
app.include_router(admin.router)
app.include_router(tokens.router)
app.include_router(user_tokens.router)
app.include_router(presets.router)
app.include_router(projects.router)
app.include_router(social.router)
app.include_router(moderation.router)
app.include_router(library.router)
app.include_router(registry.router)


@app.get("/api/health")
def health():
    return {"ok": True}
