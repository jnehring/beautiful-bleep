# SPDX-License-Identifier: MIT
from datetime import date, datetime, timezone

from sqlalchemy import JSON, BigInteger, Boolean, CheckConstraint, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base

ROLES = ("admin", "user")


def now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    __table_args__ = (CheckConstraint("role IN ('admin', 'user')", name="ck_users_role"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)  # stored lowercase
    password_hash: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(60))
    bio: Mapped[str] = mapped_column(Text, default="")
    handle: Mapped[str | None] = mapped_column(String(40), unique=True, index=True)  # the author part of a preset's address; set on first publish
    role: Mapped[str] = mapped_column(String(16), default="user")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)

    @property
    def email_verified(self) -> bool:
        from .config import settings

        return self.email_verified_at is not None or not settings.email_verification  # switched off: nothing to confirm


class EmailToken(Base):
    """A single-use link sent by email (confirm the address, reset the password). Only the SHA-256 is stored."""

    __tablename__ = "email_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    purpose: Mapped[str] = mapped_column(String(16))  # verify | reset
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class UserSession(Base):
    """A login. The cookie holds a random token; only its SHA-256 is stored, so a leaked table cannot be replayed."""

    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship()


class ApiToken(Base):
    """A release token, created by an admin. Like sessions, only the SHA-256 is stored; the token is shown once."""

    __tablename__ = "api_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    prefix: Mapped[str] = mapped_column(String(12))  # first characters, to recognise it in the list
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    scope: Mapped[str] = mapped_column(String(16), default="release")
    # The publisher this token may release for (the namespace of the developer certificate); none: only "bleep".
    publisher: Mapped[str | None] = mapped_column(String(40))
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Developer(Base):
    """A developer key an admin issued (website/content/developers/modules/signing.md). Revoking it stops releases signed with it."""

    __tablename__ = "developers"

    id: Mapped[int] = mapped_column(primary_key=True)
    publisher: Mapped[str] = mapped_column(String(40), index=True)
    key_id: Mapped[str] = mapped_column(String(32), unique=True)
    scopes: Mapped[list] = mapped_column(JSON, default=list)
    first_party: Mapped[bool] = mapped_column(Boolean, default=False)
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    not_after: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Release(Base):
    """One version of a plugin or module in the registry. Draft until published; immutable after."""

    __tablename__ = "releases"
    __table_args__ = (UniqueConstraint("kind", "slug", "version", name="uq_releases_version"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(16))  # plugin | module
    slug: Mapped[str] = mapped_column(String(64))
    version: Mapped[str] = mapped_column(String(32))
    major: Mapped[int] = mapped_column()
    minor: Mapped[int] = mapped_column()
    patch: Mapped[int] = mapped_column()
    channel: Mapped[str] = mapped_column(String(16), default="stable")  # stable | beta
    status: Mapped[str] = mapped_column(String(16), default="draft")  # draft | published
    title: Mapped[str] = mapped_column(String(120), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    summary: Mapped[str] = mapped_column(String(280), default="")  # one or two sentences for the library's tile
    category: Mapped[str] = mapped_column(String(64), default="")  # "Sources", "Modulation", …; empty if the entry has none
    image: Mapped[str] = mapped_column(String(32), default="")  # file name of the screenshot next to entry.json, "" = placeholder
    license: Mapped[str] = mapped_column(String(120), default="")  # SPDX id or expression of the release; "" = not stated
    origin: Mapped[dict] = mapped_column(JSON, default=dict)  # {name, author, url, license, copyright, changes?} of the code it is ported from; {} = original work
    requires: Mapped[dict] = mapped_column(JSON, default=dict)
    # [{path, sha256, bytes, platform, uploaded}]
    files: Mapped[list] = mapped_column(JSON, default=list)
    created_by_token: Mapped[int | None] = mapped_column(ForeignKey("api_tokens.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class UserToken(Base):
    """A personal access token: how the app and the plugins act for a user. Like sessions, only the SHA-256 is stored."""

    __tablename__ = "user_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    prefix: Mapped[str] = mapped_column(String(12))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    scope: Mapped[str] = mapped_column(String(16), default="library")  # library: publish and manage own presets, comment, rate
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship()


class DeviceCode(Base):
    """A sign-in of the app (device flow): the app holds `device_hash`, the user confirms `user_code` on the site."""

    __tablename__ = "device_codes"

    id: Mapped[int] = mapped_column(primary_key=True)
    device_hash: Mapped[str] = mapped_column(String(64), unique=True)
    user_code: Mapped[str] = mapped_column(String(9), unique=True)  # XXXX-XXXX
    client_name: Mapped[str] = mapped_column(String(80), default="")
    # Who asked: the approving user is shown it, so a code sent by someone else does not look like their own sign-in.
    start_ip: Mapped[str] = mapped_column(String(64), default="")
    start_agent: Mapped[str] = mapped_column(String(200), default="")
    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending | approved | denied | used
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Preset(Base):
    """A shared preset (data, not code): metadata here, one `.bleeppreset` file per version in the library bucket."""

    __tablename__ = "presets"
    __table_args__ = (UniqueConstraint("author_id", "slug", name="uq_presets_author_slug"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    slug: Mapped[str] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(120))
    summary: Mapped[str] = mapped_column(String(280), default="")
    type: Mapped[str] = mapped_column(String(8))  # patch | cell
    tags: Mapped[list] = mapped_column(JSON, default=list)
    license: Mapped[str] = mapped_column(String(120), default="CC-BY-4.0")
    state: Mapped[str] = mapped_column(String(16), default="listed")  # listed | unlisted (taken down by an admin or the author)
    downloads: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)

    author: Mapped[User] = relationship()
    versions: Mapped[list["PresetVersion"]] = relationship(
        back_populates="preset", cascade="all, delete-orphan", order_by="PresetVersion.version.desc()")
    credits: Mapped[list["PresetCredit"]] = relationship(cascade="all, delete-orphan")

    @property
    def address(self) -> str:
        return f"{self.author.handle}/{self.slug}"


class Project(Base):
    """A project (a whole board with its panels) a user keeps for themselves on the website: private, one row per name. The file
    formats are the same as everywhere else (library.md); nothing is shared until the user publishes it as a preset."""

    __tablename__ = "projects"
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_projects_user_name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(String(280), default="")
    tags: Mapped[list] = mapped_column(JSON, default=list)
    data: Mapped[str] = mapped_column(Text)  # the project as JSON: {nodes, cables, panels, tempo, needs, ...}
    bytes: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class PresetCredit(Base):
    """One credit of a preset: it was made from the preset at `source_address` (library.md section 6). Presets are copied, not referenced,
    so this is a label for attribution and for the source author's "used in" view; nothing loads the source. The rows are those of the
    preset's newest version and are replaced on every publish."""

    __tablename__ = "preset_credits"
    __table_args__ = (UniqueConstraint("preset_id", "source_address", name="uq_preset_credits"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    preset_id: Mapped[int] = mapped_column(ForeignKey("presets.id", ondelete="CASCADE"), index=True)
    source_address: Mapped[str] = mapped_column(String(130), index=True)  # author/slug, lower case
    source_name: Mapped[str] = mapped_column(String(120), default="")
    source_author: Mapped[str] = mapped_column(String(80), default="")


class PresetVersion(Base):
    __tablename__ = "preset_versions"
    __table_args__ = (UniqueConstraint("preset_id", "version", name="uq_preset_versions"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    preset_id: Mapped[int] = mapped_column(ForeignKey("presets.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column()
    bytes: Mapped[int] = mapped_column()
    sha256: Mapped[str] = mapped_column(String(64))
    needs: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)

    preset: Mapped[Preset] = relationship(back_populates="versions")


class Comment(Base):
    """A comment on a library entry. It belongs to the entry (kind, slug), not to one version of it."""

    __tablename__ = "comments"

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(16))
    slug: Mapped[str] = mapped_column(String(140))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

    user: Mapped[User] = relationship()


class Rating(Base):
    """One 1-5 star rating per user and library entry; rating again changes it."""

    __tablename__ = "ratings"
    __table_args__ = (
        UniqueConstraint("kind", "slug", "user_id", name="uq_ratings_user_entry"),
        CheckConstraint("stars BETWEEN 1 AND 5", name="ck_ratings_stars"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(16), index=True)
    slug: Mapped[str] = mapped_column(String(140), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    stars: Mapped[int] = mapped_column()
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class Report(Base):
    """A report of a preset or a comment, for an admin to look at."""

    __tablename__ = "reports"

    id: Mapped[int] = mapped_column(primary_key=True)
    target: Mapped[str] = mapped_column(String(16))  # preset | comment
    target_id: Mapped[int] = mapped_column()
    reporter_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reason: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AgentUsage(Base):
    """Tokens the patch assistant used per UTC day, all users together (the daily budget)."""
    __tablename__ = "agent_usage"

    day: Mapped[date] = mapped_column(Date, primary_key=True)
    tokens: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    requests: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
