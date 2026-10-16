# SPDX-License-Identifier: MIT
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

Role = Literal["admin", "user"]
LICENSE_PATTERN = r"^[A-Za-z0-9.+() -]+$"  # an SPDX id or expression, e.g. "GPL-3.0-or-later" or "MIT AND AGPL-3.0-only"
Password = Field(min_length=10, max_length=128)


def _clean_name(v: str) -> str:
    v = v.strip()
    if not v:
        raise ValueError("must not be empty")
    return v


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    email: str
    display_name: str
    bio: str
    role: Role
    is_active: bool
    email_verified: bool
    created_at: datetime


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Password
    display_name: str = Field(max_length=60)
    _name = field_validator("display_name")(_clean_name)


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(max_length=128)


class ProfileIn(BaseModel):
    """What a user may change about themselves. Role and status are deliberately not here."""

    display_name: str | None = Field(default=None, max_length=60)
    bio: str | None = Field(default=None, max_length=2000)

    @field_validator("display_name")
    @classmethod
    def _name(cls, v: str | None) -> str | None:
        return None if v is None else _clean_name(v)


class PasswordIn(BaseModel):
    current_password: str = Field(max_length=128)
    new_password: str = Password


class AdminUserIn(ProfileIn):
    role: Role | None = None
    is_active: bool | None = None


class TokenIn(BaseModel):
    name: str = Field(max_length=80)
    expires_in_days: int | None = Field(default=None, ge=1, le=3650)
    _name = field_validator("name")(_clean_name)


class TokenOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    prefix: str
    scope: str
    created_at: datetime
    expires_at: datetime | None
    last_used_at: datetime | None


class TokenCreated(TokenOut):
    token: str  # shown once


class FileIn(BaseModel):
    path: str = Field(max_length=200, pattern=r"^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$")
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    bytes: int = Field(ge=0)
    platform: str = Field(default="any", max_length=32, pattern=r"^[a-z0-9_-]+$")
    # Signing (website/content/developers/modules/signing.md): a module's content hash over the files inside its package (a plugin file's is its own
    # sha256) and the developer's signature document. Required unless the store runs with require_signatures off.
    contentDigest: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    signature: dict | None = None

    @field_validator("path")
    @classmethod
    def _no_dots(cls, v: str) -> str:
        if any(part in (".", "..") for part in v.split("/")):
            raise ValueError("bad path")
        return v


class OriginIn(BaseModel):
    """The code a module is ported from (website/content/developers/modules/writing-a-module.md, "Ported code and licences")."""
    name: str = Field(max_length=120)
    author: str = Field(max_length=120)
    url: str = Field(max_length=300, pattern=r"^https?://\S+$")  # shown as a link: http(s) only
    license: str = Field(max_length=120, pattern=LICENSE_PATTERN)
    copyright: str = Field(max_length=300)
    changes: str = Field(default="", max_length=500)


class ReleaseIn(BaseModel):
    version: str = Field(pattern=r"^\d{1,4}\.\d{1,5}\.\d{1,6}$")
    channel: Literal["stable", "beta"] = "stable"
    title: str = Field(default="", max_length=120)
    notes: str = Field(default="", max_length=20000)
    summary: str = Field(default="", max_length=280)
    category: str = Field(default="", max_length=64)
    license: str = Field(default="", max_length=120, pattern=r"^$|" + LICENSE_PATTERN)
    origin: OriginIn | None = None
    requires: dict = Field(default_factory=dict)
    files: list[FileIn] = Field(min_length=1, max_length=64)


class PlatformIn(BaseModel):
    files: list[FileIn] = Field(min_length=1, max_length=64)


class ReleaseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    kind: str
    slug: str
    version: str
    channel: str
    status: str
    files: list
    published_at: datetime | None


class StoreItemOut(BaseModel):
    kind: str
    slug: str
    version: str
    channel: str
    title: str
    summary: str
    category: str
    image_url: str | None             # the screenshot, a path on the store's host; None: the page draws a placeholder
    rating_average: float | None = None
    rating_count: int = 0
    notes: str
    files: int
    bytes: int
    published_at: datetime | None


class StoreListOut(BaseModel):
    items: list[StoreItemOut]
    categories: list[str]             # every category of the entries matching kind and search, for the filter
    total: int
    page: int
    page_size: int


class StoreFileOut(BaseModel):
    path: str
    bytes: int
    sha256: str
    platform: str
    uploaded: bool
    signer: dict | None = None        # {"publisher", "keyId"} of the developer signature


class StoreReleaseOut(BaseModel):
    version: str
    channel: str
    notes: str
    files: int
    bytes: int
    published_at: datetime | None
    license: str
    requires: dict
    file_list: list[StoreFileOut]


class StoreDetailOut(BaseModel):
    kind: str
    slug: str
    title: str
    summary: str
    category: str
    image_url: str | None
    rating_average: float | None = None
    rating_count: int = 0
    license: str                      # of the newest release; "" = not stated
    origin: dict                      # what the newest release is ported from, {} = original work
    releases: list[StoreReleaseOut]


# --- Sign-in of the app, personal tokens -------------------------------------------------------------------------

class DeviceStartIn(BaseModel):
    client_name: str = Field(default="Bleep", max_length=80)

    @field_validator("client_name")
    @classmethod
    def _plain(cls, v: str) -> str:  # shown on the approval page: no control characters, no line breaks, never empty
        return " ".join("".join(c if c.isprintable() else " " for c in v).split()) or "Bleep"


class DeviceStartOut(BaseModel):
    device_code: str                  # secret of the app, for polling
    user_code: str                    # what the user types or confirms on the site
    verification_url: str             # path on the site
    expires_in: int
    interval: int                     # seconds between polls


class DevicePollIn(BaseModel):
    device_code: str = Field(max_length=200)


class DevicePollOut(BaseModel):
    status: Literal["pending", "approved", "denied"]
    token: str | None = None          # once, when approved
    user: UserOut | None = None


class DeviceApproveIn(BaseModel):
    user_code: str = Field(max_length=20)
    approve: bool = True


class DeviceInfoOut(BaseModel):
    client_name: str      # chosen by whoever started the sign-in: not verified
    requested_from: str   # the address that started it
    requested_agent: str
    requested_seconds_ago: int


class UserTokenIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    expires_in_days: int | None = Field(default=None, ge=1, le=3650)


class UserTokenOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    prefix: str
    scope: str
    created_at: datetime
    expires_at: datetime | None
    last_used_at: datetime | None


class UserTokenCreated(UserTokenOut):
    token: str


# --- Presets -----------------------------------------------------------------------------------------------------

PresetType = Literal["patch", "cell"]
PRESET_LICENSES = ("CC-BY-4.0", "CC0-1.0")


class PresetIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    summary: str = Field(default="", max_length=280)
    type: PresetType
    slug: str | None = Field(default=None, max_length=64, pattern=r"^[a-z0-9][a-z0-9-]*$")  # default: from the title; an existing one makes a new version
    tags: list[str] = Field(default_factory=list, max_length=10)
    license: Literal["CC-BY-4.0", "CC0-1.0"] = "CC-BY-4.0"
    preset: dict

    @field_validator("title")
    @classmethod
    def _title(cls, v: str) -> str:
        return _clean_name(v)

    @field_validator("tags")
    @classmethod
    def _tags(cls, v: list[str]) -> list[str]:
        out = []
        for t in v:
            t = t.strip().lower()
            if not t or len(t) > 30 or not all(c.isalnum() or c in " -_" for c in t):
                raise ValueError("tags are up to 30 letters, digits, spaces, - or _")
            if t not in out:
                out.append(t)
        return out


class PresetPatchIn(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    summary: str | None = Field(default=None, max_length=280)
    tags: list[str] | None = Field(default=None, max_length=10)
    state: Literal["listed", "unlisted"] | None = None


class PresetVersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    version: int
    bytes: int
    sha256: str
    needs: dict
    created_at: datetime


class PresetOut(BaseModel):
    id: int
    author: str                       # handle
    author_name: str
    slug: str
    address: str                      # author/slug, the slug of this entry in the store and for comments and ratings
    title: str
    summary: str
    type: str
    tags: list[str]
    license: str
    state: str
    downloads: int
    version: int                      # newest
    bytes: int
    created_at: datetime
    updated_at: datetime
    rating_average: float | None
    rating_count: int
    versions: list[PresetVersionOut] | None = None  # only in the detail


class PresetListOut(BaseModel):
    items: list[PresetOut]
    total: int
    page: int
    page_size: int


# --- Comments, ratings, reports ----------------------------------------------------------------------------------

class CommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=2000)

    @field_validator("body")
    @classmethod
    def _body(cls, v: str) -> str:
        return _clean_name(v)


class CommentOut(BaseModel):
    id: int
    user_id: int
    author: str
    body: str
    created_at: datetime
    mine: bool = False


class CommentListOut(BaseModel):
    items: list[CommentOut]
    total: int
    page: int
    page_size: int


class RatingIn(BaseModel):
    stars: int = Field(ge=1, le=5)


class RatingOut(BaseModel):
    average: float | None
    count: int
    mine: int | None = None           # the caller's own rating when logged in


class ReportIn(BaseModel):
    reason: str = Field(default="", max_length=500)


class ReportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    target: str
    target_id: int
    reporter_id: int | None
    reason: str
    created_at: datetime
    resolved_at: datetime | None


class ForgotPasswordIn(BaseModel):
    email: EmailStr


class ResetPasswordIn(BaseModel):
    token: str = Field(min_length=10, max_length=200)
    new_password: str = Password


class EmailTokenIn(BaseModel):
    token: str = Field(min_length=10, max_length=200)


class ContactIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: EmailStr
    message: str = Field(min_length=10, max_length=5000)
    website: str = Field(default="", max_length=200)  # honeypot: hidden in the form, bots fill it

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = _clean_name(v)
        if "\n" in v or "\r" in v:
            raise ValueError("must be one line")
        return v
