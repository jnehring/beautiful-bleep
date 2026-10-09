# SPDX-License-Identifier: MIT
"""Admin console for the accounts database.

    python -m app.cli list
    python -m app.cli promote EMAIL
    python -m app.cli set-password EMAIL
    python -m app.cli token-create NAME [--days N]
    python -m app.cli token-list
    python -m app.cli token-revoke ID

In Compose:  docker compose exec api python -m app.cli list
"""
import argparse
import getpass
import secrets
import sys
from datetime import timedelta

from sqlalchemy import delete, select

from .db import SessionLocal
from .models import ApiToken, User, UserSession, now
from .security import hash_password, hash_token


def _find(db, email: str) -> User:
    user = db.scalar(select(User).where(User.email == email.strip().lower()))
    if user is None:
        sys.exit(f"No user with email {email}")
    return user


def list_users(_: argparse.Namespace) -> None:
    with SessionLocal() as db:
        users = db.scalars(select(User).order_by(User.id)).all()
    rows = [("ID", "EMAIL", "NAME", "ROLE", "ACTIVE", "CREATED")] + [
        (str(u.id), u.email, u.display_name, u.role, "yes" if u.is_active else "no", f"{u.created_at:%Y-%m-%d}")
        for u in users
    ]
    widths = [max(len(r[i]) for r in rows) for i in range(len(rows[0]))]
    for r in rows:
        print("  ".join(c.ljust(w) for c, w in zip(r, widths)).rstrip())


def promote(args: argparse.Namespace) -> None:
    with SessionLocal() as db:
        user = _find(db, args.email)
        if user.role == "admin":
            print(f"{user.email} is already an admin")
            return
        user.role = "admin"
        db.commit()
        print(f"{user.email} is now an admin")


def set_password(args: argparse.Namespace) -> None:
    with SessionLocal() as db:
        user = _find(db, args.email)
        password = getpass.getpass("New password: ")
        if not 10 <= len(password) <= 128:
            sys.exit("The password must be 10 to 128 characters")
        if getpass.getpass("Repeat: ") != password:
            sys.exit("The passwords differ")
        user.password_hash = hash_password(password)
        db.execute(delete(UserSession).where(UserSession.user_id == user.id))  # log out everywhere
        db.commit()
        print(f"Password of {user.email} changed; all their sessions ended")


def token_create(args: argparse.Namespace) -> None:
    token = "blp_" + secrets.token_urlsafe(32)
    with SessionLocal() as db:
        db.add(ApiToken(
            name=args.name, prefix=token[:8], token_hash=hash_token(token), scope="release",
            expires_at=now() + timedelta(days=args.days) if args.days else None,
        ))
        db.commit()
    print("Release token (shown once; store it, e.g. in a file only you can read):")
    print(token)


def token_list(_: argparse.Namespace) -> None:
    with SessionLocal() as db:
        tokens = db.scalars(select(ApiToken).order_by(ApiToken.id)).all()
    rows = [("ID", "NAME", "TOKEN", "CREATED", "EXPIRES", "LAST USED")] + [
        (str(t.id), t.name, t.prefix + "...", f"{t.created_at:%Y-%m-%d}",
         f"{t.expires_at:%Y-%m-%d}" if t.expires_at else "never", f"{t.last_used_at:%Y-%m-%d %H:%M}" if t.last_used_at else "never")
        for t in tokens
    ]
    widths = [max(len(r[i]) for r in rows) for i in range(len(rows[0]))]
    for r in rows:
        print("  ".join(c.ljust(w) for c, w in zip(r, widths)).rstrip())


def token_revoke(args: argparse.Namespace) -> None:
    with SessionLocal() as db:
        token = db.get(ApiToken, args.id)
        if token is None:
            sys.exit(f"No token with id {args.id}")
        db.delete(token)
        db.commit()
        print(f"Token {token.name} ({token.prefix}...) revoked")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli", description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("list", help="list all users").set_defaults(run=list_users)
    for name, fn, help_ in (("promote", promote, "make a user an admin"),
                            ("set-password", set_password, "set a user's password (prompted, never on the command line)")):
        p = sub.add_parser(name, help=help_)
        p.add_argument("email")
        p.set_defaults(run=fn)
    p = sub.add_parser("token-create", help="create a release token for scripts/release.py")
    p.add_argument("name")
    p.add_argument("--days", type=int, help="expire after this many days (default: never)")
    p.set_defaults(run=token_create)
    sub.add_parser("token-list", help="list release tokens").set_defaults(run=token_list)
    p = sub.add_parser("token-revoke", help="delete a release token")
    p.add_argument("id", type=int)
    p.set_defaults(run=token_revoke)
    args = parser.parse_args(argv)
    args.run(args)


if __name__ == "__main__":
    main()
