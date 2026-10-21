# SPDX-License-Identifier: MIT
"""Admin console for the accounts database.

    python -m app.cli list
    python -m app.cli promote EMAIL
    python -m app.cli demote EMAIL
    python -m app.cli set-password EMAIL
    python -m app.cli token-create NAME [--days 1..3650] [--publisher P] [--out FILE]
    python -m app.cli token-list
    python -m app.cli token-revoke ID
    python -m app.cli developer-create PUBLISHER [--scopes module,plugin] [--first-party --confirm] [--days 1..825] [--out FILE]
    python -m app.cli developer-list
    python -m app.cli developer-revoke KEY_ID
    python -m app.cli community-init [--days 1..825] [--out FILE]
    python -m app.cli community-takedown ID VERSION
    python -m app.cli community-ban HANDLE
    python -m app.cli receipts-backfill [--dry-run]

The token and the key kit are secrets. --out FILE writes them to a file that only the owner can read (0600). Without --out they go to
stdout, which is refused when that is a regular file other users can read (a shell redirect "> kit.json" under the default umask);
a pipe or a terminal is fine.

In Compose:  docker compose exec api python -m app.cli list
"""
import argparse
import getpass
import json
import os
import secrets
import stat
import sys
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select

from . import signing
from .config import settings
from .db import SessionLocal
from .models import ApiToken, Developer, Release, User, UserSession, now
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
        signing.write_secret(out, text + "\n")
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


def developer_create(args: argparse.Namespace) -> None:
    """Issues a developer key: a new key pair and a certificate from the library's issuer, as one JSON "kit" on stdout.

    The kit holds the developer's private key. Hand it over privately; the library keeps only the key id.
    --first-party (may sign ids without a namespace: ours only) needs --confirm. A publisher that already has an active key gets a warning.
    """
    _check_secret_destination(args.out)
    if args.first_party and not args.confirm:
        sys.exit("--first-party lets the key sign ids without a namespace (Bleep's own releases). Add --confirm if that is what you want.")
    if not (settings.issuer_key or settings.issuer_key_file) or not settings.issuer_cert:
        sys.exit("Set BLEEP_ISSUER_KEY and BLEEP_ISSUER_CERT (scripts/release/signing.py init-registry makes them)")
    scopes = [s for s in args.scopes.split(",") if s]
    if not scopes or any(s not in signing.KINDS for s in scopes):
        sys.exit("--scopes is a list of: module, plugin")
    try:
        kit = signing.issue_kit(signing.key_from_pem(signing.issuer_key_pem()), json.loads(settings.issuer_cert), args.publisher,
                                scopes=scopes, first_party=args.first_party, days=args.days, name=args.name)
    except ValueError as e:
        sys.exit(str(e))
    not_after = datetime.fromtimestamp(kit["chain"][1]["tbs"]["notAfter"], timezone.utc)
    with SessionLocal() as db:
        if db.scalar(select(User.id).where(User.handle == args.publisher)) is not None:
            sys.exit(f"{args.publisher!r} is already the name of a community author; their modules live in that namespace. Choose another publisher.")
        active = db.scalars(select(Developer).where(Developer.publisher == args.publisher, Developer.revoked_at.is_(None),
                                                    Developer.not_after > now())).all()
        if active:
            print(f"Warning: {args.publisher} already has {len(active)} active key(s) ({', '.join(d.key_id for d in active)}); "
                  "revoke the old one with developer-revoke if this replaces it.", file=sys.stderr)
        db.add(Developer(publisher=args.publisher, key_id=kit["keyId"], scopes=scopes, first_party=args.first_party, not_after=not_after))
        db.commit()
    print(f"Developer key {kit['keyId']} for {args.publisher}, valid until {not_after:%Y-%m-%d}. The kit below is a secret: hand it over privately.",
          file=sys.stderr)
    _emit_secret(json.dumps(kit, indent=1), args.out)


def community_init(args: argparse.Namespace) -> None:
    """Makes the library's community key and its certificate (signing.md section 2a) and prints the three lines for website/.env.

    The key signs every community module after the library's checks. Its certificate is issued by the issuer key, allows modules only and
    names the publisher "community". Run it again before the certificate lapses: modules published earlier stay valid through their receipts.
    The key is a secret: it lets whoever holds it publish as the library."""
    _check_secret_destination(args.out)
    if not (settings.issuer_key or settings.issuer_key_file) or not settings.issuer_cert:
        sys.exit("Set BLEEP_ISSUER_KEY and BLEEP_ISSUER_CERT first (scripts/release/signing.py init-registry makes them)")
    key = signing.Ed25519PrivateKey.generate()
    cert = signing.issue_community_cert(signing.key_from_pem(signing.issuer_key_pem()), json.loads(settings.issuer_cert), key, days=args.days)
    pem = key.private_bytes(signing.serialization.Encoding.PEM, signing.serialization.PrivateFormat.PKCS8, signing.serialization.NoEncryption()).decode()
    not_after = datetime.fromtimestamp(cert["tbs"]["notAfter"], timezone.utc)
    with SessionLocal() as db:
        db.add(Developer(publisher=signing.COMMUNITY_PUBLISHER, key_id=cert["tbs"]["keyId"], scopes=["module"], not_after=not_after))
        db.commit()
    print(f"Community key {cert['tbs']['keyId']}, valid until {not_after:%Y-%m-%d}. The lines below are a secret: put them in website/.env.", file=sys.stderr)
    lines = [f"BLEEP_COMMUNITY_KEY={pem.strip().replace(chr(10), chr(92) + 'n')}", f"BLEEP_COMMUNITY_CERT={json.dumps(cert, separators=(',', ':'))}"]
    _emit_secret("\n".join(lines), args.out)


def community_takedown(args: argparse.Namespace) -> None:
    """Withdraws one community release: it leaves the index and goes on the signed revocation list."""
    slug = args.id.replace("/", ".", 1)
    with SessionLocal() as db:
        row = db.scalar(select(Release).where(Release.kind == "module", Release.slug == slug, Release.version == args.version))
        if row is None or not any(f.get("signer", {}).get("trust") == "community" for f in row.files):
            sys.exit(f"No community module {args.id} {args.version}")
        community_router.take_down(db, get_storage(), row)
    print(f"{args.id} {args.version} taken down: clients refuse it once they have the new revocation list")


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


def receipts_backfill(args: argparse.Namespace) -> None:
    """Dates the releases that were published before the library issued publication receipts (signing.md section 6a)."""
    with SessionLocal() as db:
        try:
            dated, skipped = registry.backfill_receipts(db, get_storage(), dry_run=args.dry_run)
        except ValueError as e:
            sys.exit(str(e))
    verb = "would get" if args.dry_run else "got"
    print(f"{len(dated)} file(s) {verb} a receipt" + (":" if dated else ""))
    for line in dated:
        print("  " + line)
    if skipped:
        print(f"{len(skipped)} file(s) cannot be dated; their developers must sign them again:")
        for line in skipped:
            print("  " + line)


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
    p = sub.add_parser("developer-create", help="issue a developer key (a kit with the private key, on stdout or --out FILE)")
    p.add_argument("publisher")
    p.add_argument("--scopes", default="module", help="module, plugin or both, comma separated (default: module)")
    p.add_argument("--first-party", action="store_true", help="may sign ids without a namespace (ours only; needs --confirm)")
    p.add_argument("--confirm", action="store_true", help="confirms --first-party")
    p.add_argument("--days", type=_bounded_days(1, 825), default=365, help="validity, 1 to 825 days (default: 365)")
    p.add_argument("--out", help="write the kit to this file (mode 0600) instead of stdout")
    p.add_argument("--name", default="")
    p.set_defaults(run=developer_create)
    p = sub.add_parser("community-init", help="make the library's community key and certificate (lines for website/.env, on stdout or --out FILE)")
    p.add_argument("--days", type=_bounded_days(1, 825), default=365, help="validity of the certificate, 1 to 825 days (default: 365)")
    p.add_argument("--out", help="write the lines to this file (mode 0600) instead of stdout")
    p.set_defaults(run=community_init)
    p = sub.add_parser("community-takedown", help="withdraw one community release")
    p.add_argument("id", help="the module id, author/name")
    p.add_argument("version")
    p.set_defaults(run=community_takedown)
    p = sub.add_parser("community-ban", help="take down every community release of an author and deactivate the account")
    p.add_argument("handle")
    p.set_defaults(run=community_ban)
    sub.add_parser("developer-list", help="list issued developer keys").set_defaults(run=developer_list)
    p = sub.add_parser("developer-revoke", help="revoke a developer key")
    p.add_argument("key_id")
    p.set_defaults(run=developer_revoke)
    p = sub.add_parser("receipts-backfill", help="give releases published before receipts existed a publication receipt")
    p.add_argument("--dry-run", action="store_true", help="only list what would happen")
    p.set_defaults(run=receipts_backfill)
    args = parser.parse_args(argv)
    args.run(args)


if __name__ == "__main__":
    main()
