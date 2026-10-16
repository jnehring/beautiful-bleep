# SPDX-License-Identifier: MIT
"""Admin console for the accounts database.

    python -m app.cli list
    python -m app.cli promote EMAIL
    python -m app.cli demote EMAIL
    python -m app.cli set-password EMAIL
    python -m app.cli token-create NAME [--days N] [--publisher P]
    python -m app.cli token-list
    python -m app.cli token-revoke ID
    python -m app.cli developer-create PUBLISHER [--scopes module,plugin] [--first-party] [--days N]   > kit.json
    python -m app.cli developer-list
    python -m app.cli developer-revoke KEY_ID

In Compose:  docker compose exec api python -m app.cli list
"""
import argparse
import getpass
import json
import secrets
import sys
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select

from . import signing
from .config import settings
from .db import SessionLocal
from .models import ApiToken, Developer, User, UserSession, now
from .routers import registry
from .security import hash_password, hash_token
from .storage import get_storage


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
    token = "blp_" + secrets.token_urlsafe(32)
    with SessionLocal() as db:
        db.add(ApiToken(
            name=args.name, prefix=token[:8], token_hash=hash_token(token), scope="release", publisher=args.publisher,
            expires_at=now() + timedelta(days=args.days) if args.days else None,
        ))
        db.commit()
    print(f"Release token for {args.publisher or 'bleep'} (shown once; store it, e.g. in a file only you can read):", file=sys.stderr)
    print(token)


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


def developer_create(args: argparse.Namespace) -> None:
    """Issues a developer key: a new key pair and a certificate from the library's issuer, as one JSON "kit" on stdout.

    The kit holds the developer's private key. Hand it over privately; the library keeps only the key id.
    """
    if not settings.issuer_key or not settings.issuer_cert:
        sys.exit("Set BLEEP_ISSUER_KEY and BLEEP_ISSUER_CERT (scripts/release/signing.py init-registry makes them)")
    scopes = [s for s in args.scopes.split(",") if s]
    if not scopes or any(s not in signing.KINDS for s in scopes):
        sys.exit("--scopes is a list of: module, plugin")
    try:
        kit = signing.issue_kit(signing.key_from_pem(settings.issuer_key.replace("\\n", "\n")), json.loads(settings.issuer_cert), args.publisher,
                                scopes=scopes, first_party=args.first_party, days=args.days, name=args.name)
    except ValueError as e:
        sys.exit(str(e))
    not_after = datetime.fromtimestamp(kit["chain"][1]["tbs"]["notAfter"], timezone.utc)
    with SessionLocal() as db:
        db.add(Developer(publisher=args.publisher, key_id=kit["keyId"], scopes=scopes, first_party=args.first_party, not_after=not_after))
        db.commit()
    print(f"Developer key {kit['keyId']} for {args.publisher}, valid until {not_after:%Y-%m-%d}. The kit below is a secret: hand it over privately.",
          file=sys.stderr)
    print(json.dumps(kit, indent=1))


def developer_list(_: argparse.Namespace) -> None:
    with SessionLocal() as db:
        devs = db.scalars(select(Developer).order_by(Developer.id)).all()
    rows = [("PUBLISHER", "KEY ID", "SCOPES", "ISSUED", "VALID UNTIL", "STATE")] + [
        (d.publisher, d.key_id, ",".join(d.scopes) + (" first-party" if d.first_party else ""), f"{d.issued_at:%Y-%m-%d}",
         f"{d.not_after:%Y-%m-%d}", "revoked" if d.revoked_at else "ok")
        for d in devs
    ]
    widths = [max(len(r[i]) for r in rows) for i in range(len(rows[0]))]
    for r in rows:
        print("  ".join(c.ljust(w) for c, w in zip(r, widths)).rstrip())


def developer_revoke(args: argparse.Namespace) -> None:
    with SessionLocal() as db:
        dev = db.scalar(select(Developer).where(Developer.key_id == args.key_id))
        if dev is None:
            sys.exit(f"No developer key {args.key_id}")
        dev.revoked_at = now()
        db.commit()
        print(f"Key {dev.key_id} of {dev.publisher} revoked: releases signed with it are refused from now on")
        if registry.write_revocations(db, get_storage()):
            print("The signed revocation list (v1/revocations.json) is published: apps pick it up the next time they look")
        else:
            print("No issuer key is set (BLEEP_ISSUER_KEY, BLEEP_ISSUER_CERT): the revocation list was not published")


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
    p.add_argument("--days", type=int, help="expire after this many days (default: never)")
    p.add_argument("--publisher", help="the developer this token releases for (default: bleep, our own releases)")
    p.set_defaults(run=token_create)
    sub.add_parser("token-list", help="list release tokens").set_defaults(run=token_list)
    p = sub.add_parser("token-revoke", help="delete a release token")
    p.add_argument("id", type=int)
    p.set_defaults(run=token_revoke)
    p = sub.add_parser("developer-create", help="issue a developer key (a kit with the private key, on stdout)")
    p.add_argument("publisher")
    p.add_argument("--scopes", default="module", help="module, plugin or both, comma separated (default: module)")
    p.add_argument("--first-party", action="store_true", help="may sign ids without a namespace (ours only)")
    p.add_argument("--days", type=int, default=365)
    p.add_argument("--name", default="")
    p.set_defaults(run=developer_create)
    sub.add_parser("developer-list", help="list issued developer keys").set_defaults(run=developer_list)
    p = sub.add_parser("developer-revoke", help="revoke a developer key")
    p.add_argument("key_id")
    p.set_defaults(run=developer_revoke)
    args = parser.parse_args(argv)
    args.run(args)


if __name__ == "__main__":
    main()
