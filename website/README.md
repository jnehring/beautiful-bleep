# Beautiful Bleep website

Homepage and documentation. `content/` holds all docs as small Markdown files,
split into two separate documentations: `musicians/` and `developers/`
(the spec lives in `developers/spec/<version>/`). `app/` is a
static Next.js site that renders them.

```bash
cd website/app
npm install
npm run dev      # http://localhost:3000; regenerates public/docs + llms.txt first
npm run build    # static export to app/out/
```

With Docker (three containers: the static export behind Caddy, the API, PostgreSQL):

```bash
cp website/.env.example website/.env      # set the passwords and the first admin
docker compose -f website/docker-compose.yml --env-file website/.env up --build -d    # http://localhost:8080
docker compose -f website/docker-compose.yml --env-file website/.env down             # add -v to delete the database
```

Development with hot reload (`next dev` behind the same Caddy routes, no image rebuild):

```bash
docker compose -f website/docker-compose.yml -f website/docker-compose.dev.yml --env-file website/.env up
```
After editing `website/content` or module docs, `docker compose ... restart dev` regenerates the docs.

To keep an online installation private, set `BLEEP_BASIC_AUTH_USER` and `BLEEP_BASIC_AUTH_HASH` in `website/.env` (how to make the
hash is in `.env.example`). Caddy then asks for that user and password on every request; leave the hash empty for no password. This
covers `/api` and `/registry` too, so the Bleep App and Bleep Play cannot use a protected site.

Set `BLEEP_SITE_PORT` to use another port. The build context is the repository
root, because the site reads `website/content`, `patch/modules/*/module.json`,
`bus/include` and `scripts/`.

The module manuals are the board's own docs (`patch/modules/*/doc/*.md`, with
their screenshots); the site shows one page per doc, grouped by the board's
categories (read from `patch/board/ui/demo-types.json`). A module appears once
its doc is written.

`npm run docs` runs `scripts/docs/build-docs.py`, which also writes the single-file
versions (`/docs/api-reference-full.md`, …, versioned under `/docs/v0.1/`; the module
manuals as `/docs/modules-<category>-full.md`) and `/llms.txt`.

## Accounts (`api/`)

A FastAPI service with PostgreSQL. Caddy forwards `/api/*` to it, so the site and the API share one origin and the
session cookie (HttpOnly, SameSite=Lax, Secure when `BLEEP_COOKIE_SECURE=true`) needs no CORS.

- Roles: `user` (default for everyone who registers) and `admin`. Endpoints declare what they need with
  `Depends(require_role("admin"))` (`api/app/deps.py`). Users can edit only their own profile (`PATCH /api/me`) and
  password; admins manage every user under `/api/admin/users`. The Admin menu in the header (admins only) opens `/admin/tokens/` (create and revoke release tokens). Shared patches have a public ID: `GET /api/patches/<pid>` and `/api/patches/<pid>/<version>/file` (links, embed; see `doc/specs/sharing.md`). The public Bleep Library in the main menu (`/library/`, no login; `GET /api/library` with `kind`, `q`, `page`, `page_size`) lists what the registry has published. The last active admin
  cannot be demoted, deactivated or deleted.
- The first admin is created on start from `BLEEP_ADMIN_EMAIL` / `BLEEP_ADMIN_PASSWORD`. Everyone else registers as `user`.
- Passwords are hashed with Argon2; sessions are random tokens of which only the SHA-256 is stored.
- Schema changes are Alembic migrations (`api/migrations/`), applied when the API container starts.

```bash
cd website/api && python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/pytest                                  # in-memory SQLite, no database needed
# Develop the site against a local API: run uvicorn on :8000 (BLEEP_DATABASE_URL, BLEEP_COOKIE_SECURE=false);
# `npm run dev` proxies /api to it.
```

Admin console (promote a user, reset a password, list users; passwords are prompted, never passed as arguments):

```bash
docker compose exec api python -m app.cli list
docker compose exec api python -m app.cli promote someone@example.com
docker compose exec api python -m app.cli demote someone@example.com
docker compose exec api python -m app.cli set-password someone@example.com
```

Email (`api/app/mail.py`): registering sends a confirmation link (`/verify-email/`; unconfirmed accounts can still log in and the
account page offers to resend it), and `/forgot-password/` sends a one-hour, single-use reset link (`/reset-password/`) that also ends
every session. Links hold random tokens of which only the SHA-256 is stored; one email of a kind per user per minute. `BLEEP_EMAIL_VERIFICATION=false` switches the confirmation off. Set the
`BLEEP_SMTP_*` and `BLEEP_PUBLIC_URL` variables (see `.env.example`; Gmail needs an app password). Without `BLEEP_SMTP_HOST` the
message, link included, is written to the API log (`docker compose logs api`), which is how to try it locally.

Not in this iteration: login rate limiting.

Later the service moves into the Brilliant Bleep site's Compose stack as its
own section or subdomain. That decision is still open.
