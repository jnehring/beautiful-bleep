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


@asynccontextmanager
async def lifespan(_: FastAPI):
    ensure_admin()
    yield


app = FastAPI(title="Beautiful Bleep API", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


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
