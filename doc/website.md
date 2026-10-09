# Run the website and create the admin user

The website is three containers (`website/docker-compose.yml`): the static site behind Caddy, the API (FastAPI) and PostgreSQL. Details of the API are in `website/README.md`.

## First start

```bash
cp website/.env.example website/.env
```

Edit `website/.env`:

| Variable | Meaning |
|---|---|
| `POSTGRES_PASSWORD` | Required. Password of the database user |
| `BLEEP_ADMIN_EMAIL`, `BLEEP_ADMIN_PASSWORD` | The first admin, created when the API starts if no user has that email. The password needs 10 to 128 characters |
| `BLEEP_COOKIE_SECURE` | `false` for plain `http://localhost`; `true` when the site is served over HTTPS |
| `BLEEP_SITE_PORT` | Optional, default 8080 |

Then start it:

```bash
scripts/run-website.sh          # or: cd website && docker compose up --build -d
```

Open http://localhost:8080. The first build is slow: it compiles every module to WebAssembly (Emscripten and JUCE).

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
docker compose exec api python -m app.cli set-password you@example.com  # prompts; ends their sessions
```

Run these from `website/`. The password is typed at a prompt, never given as an argument.

## Notes

- **Database password is fixed at first start.** Postgres keeps the password it was created with in the `db-data` volume. If you change `POSTGRES_PASSWORD` later, either change it inside Postgres or delete the volume: `docker compose down -v` (this deletes all accounts).
- **Back up the database** with `docker compose exec db pg_dump -U bleep bleep > backup.sql`.
- **Updates:** `git pull && scripts/run-website.sh`. The API applies database migrations when it starts.
- **HTTPS:** the Caddyfile serves plain HTTP on port 80. For a public site put TLS in front (or change the site address in the Caddyfile so Caddy gets a certificate) and set `BLEEP_COOKIE_SECURE=true`.
- There is no login rate limiting, email verification or password reset yet.
