# SPDX-License-Identifier: MIT
"""Admin console for the accounts database.

    python -m app.cli list
    python -m app.cli promote EMAIL
    python -m app.cli demote EMAIL
    python -m app.cli set-password EMAIL
    python -m app.cli token-create NAME [--days 1..3650] [--publisher P] [--out FILE]
    python -m app.cli token-list
    python -m app.cli token-revoke ID
    python -m app.cli community-takedown ID VERSION
    python -m app.cli community-ban HANDLE

The token is a secret. --out FILE writes it to a file that only the owner can read (0600). Without --out it goes to
stdout, which is refused when that is a regular file other users can read (a shell redirect "> token" under the default umask);
a pipe or a terminal is fine.

In Compose:  docker compose exec api python -m app.cli list
"""
import argparse
import getpass
import os
import secrets
import stat
import sys
from datetime import timedelta

from sqlalchemy import delete, select

from .db import SessionLocal
from .models import ApiToken, Release, User, UserSession, now
from .routers import community as community_router
from .routers import registry
from .security import hash_password, hash_token
from .storage import get_storage


def _bounded_days(low: int, high: int):
    def parse(text: str) -> int:
        try:
            n = int(text)
        except ValueError:
            raise argparse.ArgumentTypeError(f"{text!r} is not a number of days") from None
        if not low <= n <= high:
            raise argparse.ArgumentTypeError(f"must be between {low} and {high} days")
        return n
    return parse


def _stdout_is_readable_file() -> bool:
    """True when stdout is a regular file that group or others can read (a pipe, a terminal, or no real stdout: False)."""
    try:
        st = os.fstat(sys.stdout.fileno())
    except (OSError, ValueError, AttributeError):
        return False
    return stat.S_ISREG(st.st_mode) and bool(st.st_mode & 0o044)


def _check_secret_destination(out: str | None) -> None:
    """Call before anything is created: a secret must not end up in a world-readable file."""
    if out is None and _stdout_is_readable_file():
        sys.exit("Refusing to write a secret to a file that other users can read. Use --out FILE (written with mode 0600), "
                 "or pipe the output instead of redirecting it to a file.")


def _emit_secret(text: str, out: str | None) -> None:
    if out is None:
        print(text)
        return
    try:
        # 0600 from the first byte (no moment with default permissions); an existing file is replaced
        fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, "O_NOFOLLOW", 0), 0o600)
        try:
            os.fchmod(fd, 0o600)  # an older file keeps its mode through O_CREAT; fix it before the new content goes in
            with os.fdopen(fd, "wb") as f:
                fd = -1
                f.write((text + "\n").encode())
        finally:
            if fd >= 0:
                os.close(fd)
    except OSError as e:
        sys.exit(f"Cannot write {out}: {e}")
    print(f"Written to {out} (mode 0600)", file=sys.stderr)


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


def demote(args: argparse.Namespace) -> None:
    with SessionLocal() as db:
        user = _find(db, args.email)
        if user.role == "user":
            print(f"{user.email} is already a normal user")
            return
        user.role = "user"
        db.commit()
        print(f"{user.email} is now a normal user")


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
    _check_secret_destination(args.out)
    token = "blp_" + secrets.token_urlsafe(32)
    with SessionLocal() as db:
        if args.publisher == "community":
            sys.exit("'community' is the library's own name; choose another publisher.")
        if args.publisher and db.scalar(select(User.id).where(User.handle == args.publisher)) is not None:
            sys.exit(f"{args.publisher!r} is already the name of a community author; their modules live in that namespace. Choose another publisher.")
        db.add(ApiToken(
            name=args.name, prefix=token[:8], token_hash=hash_token(token), scope="release", publisher=args.publisher,
            expires_at=now() + timedelta(days=args.days) if args.days else None,
        ))
        db.commit()
    print(f"Release token for {args.publisher or 'bleep'} (shown once; store it, e.g. in a file only you can read):", file=sys.stderr)
    _emit_secret(token, args.out)


def token_list(_: argparse.Namespace) -> None:
    with SessionLocal() as db:
        tokens = db.scalars(select(ApiToken).order_by(ApiToken.id)).all()
    rows = [("ID", "NAME", "PUBLISHER", "TOKEN", "CREATED", "EXPIRES", "LAST USED")] + [
        (str(t.id), t.name, t.publisher or "bleep", t.prefix + "...", f"{t.created_at:%Y-%m-%d}",
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


def community_takedown(args: argparse.Namespace) -> None:
    """Withdraws one community release: it leaves the index."""
    slug = args.id.replace("/", ".", 1)
    with SessionLocal() as db:
        row = db.scalar(select(Release).where(Release.kind == "module", Release.slug == slug, Release.version == args.version))
        if row is None or not any(f.get("author") for f in row.files):
            sys.exit(f"No community module {args.id} {args.version}")
        community_router.take_down(db, get_storage(), row)
    print(f"{args.id} {args.version} taken down")


def community_ban(args: argparse.Namespace) -> None:
    """Takes down every community release of an author and deactivates the account."""
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.handle == args.handle))
        if user is None:
            sys.exit(f"No author with the name {args.handle}")
        rows = db.scalars(select(Release).where(Release.kind == "module", Release.slug.like(f"{args.handle}.%"), Release.status == "published")).all()
        for row in rows:
            row.status = "taken_down"
        user.is_active = False
        db.query(UserSession).filter(UserSession.user_id == user.id).delete()
        db.commit()
        registry.write_index(db, get_storage())
    print(f"{args.handle}: {len(rows)} release(s) taken down, the account is deactivated and signed out")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli", description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("list", help="list all users").set_defaults(run=list_users)
    for name, fn, help_ in (("promote", promote, "make a user an admin"),
                            ("demote", demote, "make an admin a normal user"),
                            ("set-password", set_password, "set a user's password (prompted, never on the command line)")):
        p = sub.add_parser(name, help=help_)
        p.add_argument("email")
        p.set_defaults(run=fn)
    p = sub.add_parser("token-create", help="create a release token for scripts/release/release.py")
    p.add_argument("name")
    p.add_argument("--days", type=_bounded_days(1, 3650), help="expire after this many days, 1 to 3650 (default: never)")
    p.add_argument("--out", help="write the token to this file (mode 0600) instead of stdout")
    p.add_argument("--publisher", help="the developer this token releases for (default: bleep, our own releases)")
    p.set_defaults(run=token_create)
    sub.add_parser("token-list", help="list release tokens").set_defaults(run=token_list)
    p = sub.add_parser("token-revoke", help="delete a release token")
    p.add_argument("id", type=int)
    p.set_defaults(run=token_revoke)
    p = sub.add_parser("community-takedown", help="withdraw one community release")
    p.add_argument("id", help="the module id, author/name")
    p.add_argument("version")
    p.set_defaults(run=community_takedown)
    p = sub.add_parser("community-ban", help="take down every community release of an author and deactivate the account")
    p.add_argument("handle")
    p.set_defaults(run=community_ban)
    args = parser.parse_args(argv)
    args.run(args)


if __name__ == "__main__":
    main()
