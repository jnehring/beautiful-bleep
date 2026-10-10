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
    # Registry storage (S3 API). Without an endpoint, releases are kept in memory (tests).
    s3_endpoint: str | None = None
    s3_bucket: str = "bleep-registry"
    s3_access_key: str = ""
    s3_secret_key: str = ""
    # Code signing (doc/specs/signing.md). The root PUBLIC keys (hex, comma separated; two during a rotation) are all the
    # registry needs to check releases: the root private key must never be here. The issuer key (PEM) and its certificate
    # (JSON) are only for `python -m app.cli developer-create`.
    root_public_keys: str = ""
    issuer_key: str | None = None
    issuer_cert: str | None = None
    # A release without a valid signature is refused. Only turn this off for local experiments.
    require_signatures: bool = True

    @property
    def roots(self) -> list[bytes]:
        return [bytes.fromhex(k.strip()) for k in self.root_public_keys.split(",") if k.strip()]


settings = Settings()
