# SPDX-License-Identifier: MIT
from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy import select

from .config import settings
from .db import SessionLocal
from .models import User
from .routers import admin, auth, profile, registry, store, tokens
from .security import hash_password


def ensure_admin() -> None:
    """Create the first admin from BLEEP_ADMIN_EMAIL / BLEEP_ADMIN_PASSWORD; never touches an existing user."""
    if not (settings.admin_email and settings.admin_password):
        return
    email = settings.admin_email.lower()
    with SessionLocal() as db:
        if db.scalar(select(User).where(User.email == email)) is None:
            db.add(User(email=email, password_hash=hash_password(settings.admin_password),
                        display_name="Admin", role="admin"))
            db.commit()


@asynccontextmanager
async def lifespan(_: FastAPI):
    ensure_admin()
    yield


app = FastAPI(title="Beautiful Bleep API", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
app.include_router(auth.router)
app.include_router(profile.router)
app.include_router(admin.router)
app.include_router(tokens.router)
app.include_router(store.router)
app.include_router(registry.router)


@app.get("/api/health")
def health():
    return {"ok": True}
