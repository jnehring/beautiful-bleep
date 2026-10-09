# Bleep Patch website

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

Set `BLEEP_SITE_PORT` to use another port. The build context is the repository
root, because the site reads `website/content`, `patch/modules/*/module.json`,
`bus/include` and `scripts/`.

The module manuals are the board's own docs (`patch/modules/*/doc/*.md`, with
their screenshots); the site shows one page per doc, grouped by the board's
categories (read from `patch/board/ui/demo-types.json`). A module appears once
its doc is written.

`npm run docs` runs `scripts/build-docs.py`, which also writes the single-file
versions (`/docs/api-reference-full.md`, …, versioned under `/docs/v0.1/`; the module
manuals as `/docs/modules-<category>-full.md`) and `/llms.txt`.

## Accounts (`api/`)

A FastAPI service with PostgreSQL. Caddy forwards `/api/*` to it, so the site and the API share one origin and the
session cookie (HttpOnly, SameSite=Lax, Secure when `BLEEP_COOKIE_SECURE=true`) needs no CORS.

- Roles: `user` (default for everyone who registers) and `admin`. Endpoints declare what they need with
  `Depends(require_role("admin"))` (`api/app/deps.py`). Users can edit only their own profile (`PATCH /api/me`) and
  password; admins manage every user under `/api/admin/users` (there is no admin page yet). The last active admin
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

Not in this iteration: email verification, password reset, login rate limiting.

Later the service moves into the Brilliant Bleep site's Compose stack as its
own section or subdomain. That decision is still open.
