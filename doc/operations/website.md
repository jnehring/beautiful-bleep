# Run the website and create the admin user

The website is five containers (`website/docker-compose.yml`): the static site behind Caddy, the API (FastAPI), PostgreSQL and the library's object storage (SeaweedFS, with a one-shot `storage-init` that creates the bucket). Details of the API are in `website/README.md`.

## First start

```bash
cp website/.env.example website/.env
```

Edit `website/.env`:

| Variable | Meaning |
|---|---|
| `POSTGRES_PASSWORD` | Required. Password of the database user |
| `BLEEP_ADMIN_EMAIL`, `BLEEP_ADMIN_PASSWORD` | The first admin, created when the API starts if no user has that email. The password needs 10 to 128 characters |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY` | Required secret for the library storage; the API writes releases with it |
| `BLEEP_COOKIE_SECURE` | defaults to `true` (HTTPS); set `false` only for plain `http://localhost` development |
| `BLEEP_SITE_PORT` | Optional, default 8080 |
| `BLEEP_SITE_ADDRESS`, `BLEEP_SITE_TLS_PORT` | Optional automatic HTTPS, default off (`:80`, plain HTTP); see the HTTPS entry under [Notes](#notes) |

Then start it:

```bash
./bleep run site          # or: cd website && docker compose up --build -d
```

Open http://localhost:8080. The image build takes about a minute: it contains the site, the docs and the board's UI, but **no modules**. Bleep Play at `/board/` installs its modules by itself, from the Bleep Library of the same site, the first time a board needs one: it reads `/registry/v1/index.json`, downloads the module's package, checks it in the browser and only then runs it. A visitor needs nothing installed. Until modules have been released to the library, the board runs but stays silent ("cannot load …" in its status line).

Getting modules into the library takes three steps, all on your machine:

```bash
scripts/build/build-web.sh --docker --modules-only   # compile every module to .wasm (Emscripten in Docker: no local emsdk needed)
```

```bash
scripts/release/package-module.py                    # one .bleepmod per module, in build/library/modules
```

```bash
scripts/release/release.py --modules --level patch --registry http://localhost:8080 --token-file ~/.bleep-release-token
```

The first build compiles every module (slow; on Apple Silicon the image runs emulated); later builds recompile only the modules whose files changed (the compiler's dependency list is hashed in `build/web/modules/.cache/`; delete that folder to force a full rebuild, `BLEEP_WEB_ONLY=oscillator,filter` builds just those). `release.py --modules` releases only the modules whose package content changed since their newest published version, so running it again after a small change releases that one module.

Other commands: `./bleep run site down | logs | rebuild`.

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

Release tokens for `scripts/release/release.py` come from the same console: `token-create NAME [--days 1..3650] [--publisher P] [--out FILE]`, `token-list`, `token-revoke ID` (the token is a secret: `--out FILE` writes it with mode 0600, and without `--out` the command refuses to print into a file that other users can read, as `> token` under the default umask would; a pipe or terminal is fine; see [release.md](release.md)).

Community modules (anyone with an account shares a module): `community-takedown AUTHOR/NAME VERSION` withdraws a release from the index, and `community-ban HANDLE` takes down an author's whole catalogue and deactivates the account. Reports from users show in the admin console's report list (`target: module`). Authors upload with `scripts/release/community-publish.py`.

Run these from `website/`. The password is typed at a prompt, never given as an argument.

## Community modules

Anyone with an account can publish a module (see [Publishing a module](../../website/content/developers/modules/publishing.md)); the library checks it (files, `.wasm` imports and exports, node types, licence) and publishes it. There is nothing to set up: no keys are involved.

**Moderation.**

- Users report a module from the library; reports appear in the admin console with `target: module` (the id is the release id).
- Withdraw a release: `docker compose exec api python -m app.cli community-takedown AUTHOR/NAME VERSION`. It leaves the index, so nobody can install it any more (installed copies stay until removed). The version number stays used.
- Remove an author: `community-ban HANDLE` takes down all their releases, deactivates the account and ends its sessions.

**What to check after setup.** Upload a test module with a test account (`scripts/release/community-publish.py ... --check` first); it must show up in the library list marked *community*.

## Notes

- **Database password is fixed at first start.** Postgres keeps the password it was created with in the `db-data` volume. If you change `POSTGRES_PASSWORD` later, either change it inside Postgres or delete the volume: `docker compose down -v` (this deletes all accounts).
- **Back up the database** with `docker compose exec db pg_dump -U bleep bleep > backup.sql`.
- **Updates:** `git pull && ./bleep run site`. The API applies database migrations when it starts.
- **Security headers:** the Caddyfile sends a CSP (pages: same-origin; no inline scripts in the header policy: `website/app/scripts/csp-hashes.mjs` (run by `npm run build`, so by the Docker build) puts a `<meta>` CSP with the sha256 of each page's inline scripts into every exported page, and the browser applies header and meta together; styles keep `'unsafe-inline'`; `/registry/*`: `default-src 'none'; sandbox`), HSTS, `nosniff`, `X-Frame-Options: DENY`, a Referrer-Policy and a Permissions-Policy. Bleep Play's origin list (`ws://127.0.0.1:*` for the app bridge, `'wasm-unsafe-eval'` for the modules) is in the CSP: extend it there if the page needs another origin. `Caddyfile.dev` has none (`next dev` needs `eval`).
- **HTTPS:** by default the Caddyfile serves plain HTTP on port 80 (`BLEEP_SITE_ADDRESS` unset = `:80`): put TLS in front and set `BLEEP_COOKIE_SECURE=true`. Alternatively Caddy can get its own Let's Encrypt certificate: point the domain's DNS at the host, open ports 80 and 443 and set in `website/.env`

  ```
  BLEEP_SITE_ADDRESS=beautifulbleep.com
  BLEEP_SITE_PORT=80
  BLEEP_SITE_TLS_PORT=443
  BLEEP_COOKIE_SECURE=true
  BLEEP_PUBLIC_URL=https://beautifulbleep.com
  ```

  then `docker compose ... up -d`. Caddy redirects HTTP to HTTPS and renews the certificate; the certificates are kept in the `caddy-data` volume (do not delete it, Let's Encrypt rate-limits new certificates). Check the Caddyfile with `docker run --rm -i caddy:2-alpine caddy validate --config - --adapter caddyfile < website/Caddyfile`.
- There is no login rate limiting, email verification or password reset yet.
