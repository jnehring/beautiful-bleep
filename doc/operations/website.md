# Run the website and create the admin user

The website is five containers (`website/docker-compose.yml`): the static site behind Caddy, the API (FastAPI), PostgreSQL and the registry's object storage (SeaweedFS, with a one-shot `storage-init` that creates the bucket). Details of the API are in `website/README.md`.

## First start

```bash
cp website/.env.example website/.env
```

Edit `website/.env`:

| Variable | Meaning |
|---|---|
| `POSTGRES_PASSWORD` | Required. Password of the database user |
| `BLEEP_ADMIN_EMAIL`, `BLEEP_ADMIN_PASSWORD` | The first admin, created when the API starts if no user has that email. The password needs 10 to 128 characters |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY` | Required secret for the registry storage; the API writes releases with it |
| `BLEEP_COOKIE_SECURE` | `false` for plain `http://localhost`; `true` when the site is served over HTTPS |
| `BLEEP_SITE_PORT` | Optional, default 8080 |

Then start it:

```bash
scripts/run-website.sh          # or: cd website && docker compose up --build -d
```

Open http://localhost:8080. The image build takes about a minute: it contains the site, the docs and the board's UI, but **not the board's WebAssembly modules**. Those are built on the host and mounted into the site container (read-only), so changing the site never recompiles them:

```bash
scripts/build-web.sh --docker --modules-only   # in the Emscripten Docker image: no local emsdk needed
scripts/build-web.sh --modules-only            # or with a local Emscripten SDK (emcc on the PATH)
```

The first run compiles every module (slow; on Apple Silicon the image runs emulated). Later runs rebuild only the modules whose files changed (the compiler's dependency list is hashed in `build/web/modules/.cache/`); an unchanged run takes seconds. To force a full rebuild, delete `build/web/modules/.cache`. `BLEEP_WEB_ONLY=oscillator,filter` builds just those and keeps the rest of the manifest.

Without `build/web/modules`, the site runs but the Bleep Board at `/board/` has no modules. `BLEEP_WEB_MODULES` in `website/.env` points compose at another folder. (This is temporary: modules will come from the registry.)

Other commands: `scripts/run-website.sh down | logs | rebuild`.

## Create the admin user

**Option 1, at the first start:** set `BLEEP_ADMIN_EMAIL` and `BLEEP_ADMIN_PASSWORD` in `website/.env` before starting. After the first start, remove `BLEEP_ADMIN_PASSWORD` from the file; it is only read when the admin does not exist yet, and an existing user is never changed.

**Option 2, from an existing user:** register on the website, then promote that account:

```bash
cd website
docker compose exec api python -m app.cli promote you@example.com
```

## Admin console

```bash
docker compose exec api python -m app.cli list                          # all users
docker compose exec api python -m app.cli promote you@example.com       # make an admin
docker compose exec api python -m app.cli demote you@example.com        # make a normal user
docker compose exec api python -m app.cli set-password you@example.com  # prompts; ends their sessions
```

Release tokens for `scripts/release.py` come from the same console: `token-create NAME [--days N]`, `token-list`, `token-revoke ID` (see [release.md](release.md)).

Run these from `website/`. The password is typed at a prompt, never given as an argument.

## Notes

- **Database password is fixed at first start.** Postgres keeps the password it was created with in the `db-data` volume. If you change `POSTGRES_PASSWORD` later, either change it inside Postgres or delete the volume: `docker compose down -v` (this deletes all accounts).
- **Back up the database** with `docker compose exec db pg_dump -U bleep bleep > backup.sql`.
- **Updates:** `git pull && scripts/run-website.sh`. The API applies database migrations when it starts.
- **HTTPS:** the Caddyfile serves plain HTTP on port 80. For a public site put TLS in front (or change the site address in the Caddyfile so Caddy gets a certificate) and set `BLEEP_COOKIE_SECURE=true`.
- There is no login rate limiting, email verification or password reset yet.
