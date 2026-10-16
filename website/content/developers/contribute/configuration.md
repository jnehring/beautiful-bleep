---
title: Configuration (.env)
description: Every setting in website/.env: what it does, its default, and what a production installation needs.
order: 40
---

# Configuration (`website/.env`)

The site is configured through one file, `website/.env`. Docker Compose reads it (`--env-file website/.env`) and hands the values to the containers. Start from the template:

```bash
cp website/.env.example website/.env
```

The file holds secrets and is git-ignored: never commit it. Lines starting with `#` are comments. A value that contains `$` (the password hash below) goes in single quotes, otherwise Compose expands it. After changing the file, recreate the containers: `docker compose -f website/docker-compose.yml --env-file website/.env up -d`.

## Production checklist

- `POSTGRES_PASSWORD` and `S3_SECRET_KEY` set to long random values.
- `BLEEP_COOKIE_SECURE=true` and `BLEEP_PUBLIC_URL` set to the real `https://` address.
- `BLEEP_ROOT_PUBLIC_KEYS` set and `BLEEP_REQUIRE_SIGNATURES=true`, so the library only accepts signed releases.
- `BLEEP_ADMIN_PASSWORD` removed again after the first start.
- Optionally `BLEEP_BASIC_AUTH_HASH` set, to keep an installation private while it is online.

## Database and storage

| Variable | Default | Meaning |
|---|---|---|
| `POSTGRES_PASSWORD` | none, **required** | Password of the `bleep` user in PostgreSQL. Compose refuses to start without it. |
| `S3_ACCESS_KEY` | `bleep` | Access key of the object storage (SeaweedFS) that holds releases and preset files. |
| `S3_SECRET_KEY` | none, **required** | Secret key of the object storage. Also used by the release script when it uploads. |
| `BLEEP_REGISTRY_BUCKET` | `bleep-registry` | Name of the storage bucket. It is created on start if missing. Caddy serves it read-only at `/registry/`. |
| `BLEEP_S3_PORT` | `8333` | Port on `127.0.0.1` where the storage S3 API listens, for the release script. Never published to the network. |

## Site and accounts

| Variable | Default | Meaning |
|---|---|---|
| `BLEEP_SITE_PORT` | `8080` | Port on the host where the site (Caddy) listens. TLS ends in front of this port, in a load balancer or reverse proxy. |
| `BLEEP_PUBLIC_URL` | `http://localhost:8080` | The address people reach the site at, without a trailing slash. The links in emails (confirmation, password reset) point here. |
| `BLEEP_COOKIE_SECURE` | `true` | Send the session cookie over HTTPS only. **Must be `true` in production.** Set `false` only for local `http://localhost` development; `.env.example` ships with `false`. |
| `BLEEP_ADMIN_EMAIL` | empty | Email of the first admin. If this and the password are set and no user has the email yet, the account is created when the API starts. |
| `BLEEP_ADMIN_PASSWORD` | empty | Password of that first admin. Remove it from the file after the first start. |
| `BLEEP_ALLOWED_ORIGINS` | empty | Extra hosts (comma separated `host[:port]`) that may send cookie-authenticated writes to the API, for example a development server on another port. Not in `.env.example`; add the line when you need it. |

## Email

Registration confirmation, password reset and the contact form send email. Without `BLEEP_SMTP_HOST` nothing is sent: each message, link included, is written to the API log (`docker compose logs api`), which is how to try it locally.

| Variable | Default | Meaning |
|---|---|---|
| `BLEEP_SMTP_HOST` | empty | SMTP server, for example `smtp.gmail.com`. Empty means log only. |
| `BLEEP_SMTP_PORT` | `587` | SMTP port (STARTTLS). |
| `BLEEP_SMTP_USER` | empty | SMTP login. For Gmail, turn on 2-step verification and create an app password. |
| `BLEEP_SMTP_PASSWORD` | empty | SMTP password (the app password for Gmail, without spaces). |
| `BLEEP_SMTP_FROM` | the SMTP user | Sender address of outgoing messages. |
| `BLEEP_CONTACT_TO` | the SMTP user | Where the contact form delivers messages. |
| `BLEEP_EMAIL_VERIFICATION` | `true` | `true`: registering sends a confirmation link. `false`: nobody is asked to confirm (password reset still works). |

## Code signing

The library only accepts signed releases (see [signing](../modules/signing.md) and [the library](../modules/library.md)). Create the values once with `scripts/release/signing.py init-registry ~/bleep-registry-keys` and paste the lines it writes to `registry.env`.

| Variable | Default | Meaning |
|---|---|---|
| `BLEEP_ROOT_PUBLIC_KEYS` | empty | Root **public** key(s) in hex, comma separated (two during a key rotation). They decide which releases are accepted. The root private key never belongs in this file; keep it offline. |
| `BLEEP_ISSUER_KEY` | empty | Private key (PEM) of the issuer. Only needed to create developer keys with `python -m app.cli developer-create`. |
| `BLEEP_ISSUER_CERT` | empty | The issuer's certificate (JSON), signed by the root key. Goes with `BLEEP_ISSUER_KEY`. |
| `BLEEP_REQUIRE_SIGNATURES` | `true` | Refuse a release without a valid signature. Turn off only for local experiments. |

## Password for the whole site

Keeps an online installation private: Caddy asks for a user name and password (HTTP basic auth) before it serves anything. It is off while the hash is empty.

| Variable | Default | Meaning |
|---|---|---|
| `BLEEP_BASIC_AUTH_USER` | `bleep` | User name the browser asks for. |
| `BLEEP_BASIC_AUTH_HASH` | empty | bcrypt hash of the password. Empty means no password. |

Make the hash and paste it in **single quotes**:

```bash
docker run --rm caddy:2-alpine caddy hash-password --plaintext 'the-password'
```

```
BLEEP_BASIC_AUTH_USER=bleep
BLEEP_BASIC_AUTH_HASH='$2a$14$...'
```

The password covers everything, `/api` and `/registry` included, so the Bleep App and Bleep Play cannot use a protected site. It does not replace HTTPS: basic auth sends the password with every request, so serve the site over HTTPS only. Only the production `Caddyfile` has it; `Caddyfile.dev` does not.

## Other variables

These are not in `.env.example`. They are read by the API or by scripts, mostly when run outside Compose.

| Variable | Default | Meaning |
|---|---|---|
| `BLEEP_DATABASE_URL` | local PostgreSQL URL | Database connection. Compose builds it from `POSTGRES_PASSWORD`; set it yourself only when running the API directly (`uvicorn`, tests use in-memory SQLite). |
| `BLEEP_KEY_PASSPHRASE` | unset | Passphrase for an encrypted developer or issuer key, read by the signing tools. |
| `BLEEP_RELEASE_TOKEN`, `BLEEP_REGISTRY_URL` | unset | Used by the release script to publish to a library. See [build and release](../setup/build-and-release.md). |
