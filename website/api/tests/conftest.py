# SPDX-License-Identifier: MIT
import os

# Tests run on an in-memory SQLite; the schema comes from the models (migrations are checked against Postgres in Compose).
os.environ["BLEEP_DATABASE_URL"] = "sqlite://"
os.environ["BLEEP_COOKIE_SECURE"] = "false"

import pytest
from fastapi.testclient import TestClient

from app import models  # noqa: E402,F401
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import User  # noqa: E402
from app.security import hash_password  # noqa: E402


@pytest.fixture(autouse=True)
def schema():
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def make_admin():
    def make(email="admin@example.com", password="admin-password-1"):
        with SessionLocal() as db:
            db.add(User(email=email, password_hash=hash_password(password), display_name="Admin", role="admin"))
            db.commit()
        return email, password
    return make
