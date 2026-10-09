# SPDX-License-Identifier: MIT
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuration from environment variables prefixed BLEEP_ (see website/.env.example)."""

    model_config = SettingsConfigDict(env_prefix="BLEEP_", env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://bleep:bleep@localhost:5432/bleep"
    # The session cookie is only sent over HTTPS unless this is turned off (local http development).
    cookie_secure: bool = True
    session_days: int = 30
    # If both are set, this admin is created on start when no user has the email yet.
    admin_email: str | None = None
    admin_password: str | None = None


settings = Settings()
