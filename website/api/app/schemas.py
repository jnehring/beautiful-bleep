# SPDX-License-Identifier: MIT
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

Role = Literal["admin", "user"]
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
