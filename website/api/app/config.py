# SPDX-License-Identifier: MIT
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuration from environment variables prefixed BLEEP_ (see website/.env.example)."""

    model_config = SettingsConfigDict(env_prefix="BLEEP_", env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://bleep:bleep@localhost:5432/bleep"
    # The session cookie is only sent over HTTPS unless this is turned off (local http development).
    cookie_secure: bool = True
    session_days: int = 30
    # Limits on sign-in, registration, password reset and device sign-in (app/ratelimit.py). Only turn off for tests.
    rate_limits: bool = True
    # If both are set, this admin is created on start when no user has the email yet.
    admin_email: str | None = None
    admin_password: str | None = None
    # Library storage (S3 API). Without an endpoint, releases are kept in memory (tests).
    s3_endpoint: str | None = None
    s3_bucket: str = "bleep-registry"
    s3_access_key: str = ""
    s3_secret_key: str = ""

    # Outgoing email (registration confirmation, password reset). Without smtp_host nothing is sent: the message is logged instead.
    # Gmail: smtp.gmail.com:587 with an app password (STARTTLS). smtp_from defaults to smtp_user.
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_user: str | None = None
    smtp_password: str | None = None
    smtp_from: str | None = None
    # Without smtp_host the message is only logged. The log line has recipient and subject; the body (with the one-time link) only if this is on (local development).
    log_mail_bodies: bool = False
    # Where contact-form messages go. Defaults to smtp_user.
    contact_to: str | None = None
    # The site's public address, for the links in emails (no trailing slash).
    public_url: str = "http://localhost:8080"
    # false: registration sends no confirmation link and nobody is asked to confirm. Password reset emails are unaffected.
    email_verification: bool = True
    verify_hours: int = 48
    reset_minutes: int = 60

    # The patch assistant (agent/, doc/specs/agent.md). Off by default: nothing is mounted that calls a model.
    agent_enabled: bool = False
    # Daily token budget (input + output) for ALL users together; resets at 00:00 UTC. 0 = no new runs.
    agent_daily_tokens: int = 1_000_000
    agent_model: str = "google:gemini-3.8-flash"
    agent_embed_model: str = "gemini-embedding-2"
    # catalog.json, presets.jsonl and docs.sqlite (./bleep build agent-data), relative to the API's working directory.
    agent_data_dir: str = "agent_data"
    # Chat requests per user per minute (in memory, per process). 0 = no limit.
    agent_user_per_minute: int = 6
    agent_max_steps: int = 20
    # The assistant's run log (table agent_log): every model call, tool call, result and event of each run, newest kept. The size is in rows
    # ("messages": one row per model call, tool call, event...); about 25 rows per run. 0 = no log. Contains users' prompts and patches.
    agent_log_messages: int = 5000
    # The provider keys are the providers' own variables, read from the environment: GOOGLE_API_KEY (gemini-*) and OPENAI_API_KEY (gpt-*).
    # Signs the resume tokens of paused runs; random per process when empty (a restart then ends pending runs).
    agent_state_secret: str = ""

    # Hosts besides the API's own that may send cookie-authenticated writes (comma separated host[:port]), e.g. a dev server.
    allowed_origins: str = ""

    @property
    def allowed_origin_hosts(self) -> list[str]:
        return [h.strip() for h in self.allowed_origins.split(",") if h.strip()]


settings = Settings()
