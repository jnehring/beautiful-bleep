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
| `BLEEP_ROOT_PUBLIC_KEYS`, `BLEEP_ISSUER_KEY`, `BLEEP_ISSUER_CERT` | The library's signing keys (see [Signing keys](#signing-keys)). Without the root public key the library refuses every release |
| `BLEEP_REQUIRE_SIGNATURES` | Default `true`: a release without a valid developer signature is refused. Only turn it off for local experiments |

Then start it:

```bash
scripts/run/run-website.sh          # or: cd website && docker compose up --build -d
```

Open http://localhost:8080. The image build takes about a minute: it contains the site, the docs and the board's UI, but **no modules**. Bleep Play at `/board/` installs its modules by itself, from the Bleep Library of the same site, the first time a board needs one: it reads `/registry/v1/index.json`, downloads the module's package, checks its signature in the browser and only then runs it. A visitor needs nothing installed. Until modules have been released to the library, the board runs but stays silent ("cannot load …" in its status line).

Getting modules into the library takes three steps, all on your machine (the signing keys are in [Signing keys](#signing-keys) below):

```bash
scripts/build/build-web.sh --docker --modules-only   # compile every module to .wasm (Emscripten in Docker: no local emsdk needed)
```

```bash
scripts/release/package-module.py                    # one signed-ready .bleepmod per module, in build/library/modules
```

```bash
scripts/release/release.py --modules --level patch --registry http://localhost:8080 --token-file ~/.bleep-release-token --kit ~/.bleep-signing-kit.json
```

The first build compiles every module (slow; on Apple Silicon the image runs emulated); later builds recompile only the modules whose files changed (the compiler's dependency list is hashed in `build/web/modules/.cache/`; delete that folder to force a full rebuild, `BLEEP_WEB_ONLY=oscillator,filter` builds just those). `release.py --modules` releases only the modules whose package content changed since their newest published version, so running it again after a small change releases that one module.

Other commands: `scripts/run/run-website.sh down | logs | rebuild`.

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

Release tokens for `scripts/release/release.py` come from the same console: `token-create NAME [--days 1..3650] [--publisher P] [--out FILE]`, `token-list`, `token-revoke ID`; developer signing keys with `developer-create PUBLISHER [--days 1..825] [--out FILE] [--first-party --confirm]` (warns when the publisher already has an active key), `developer-list`, `developer-revoke` (the token and the key kit are secrets: `--out FILE` writes them with mode 0600, and without `--out` the command refuses to print into a file that other users can read, as `> kit.json` under the default umask would; a pipe or terminal is fine; see [release.md](release.md); the keys the library needs are `BLEEP_ROOT_PUBLIC_KEYS`, `BLEEP_ISSUER_KEY` and `BLEEP_ISSUER_CERT` in `website/.env`).

Community modules (anyone with an account shares a module; the library signs it): `community-init [--days 1..825] [--out FILE]` makes the community key and prints the two `.env` lines (once, and again before the certificate lapses), `community-takedown AUTHOR/NAME VERSION` withdraws a release onto the signed revocation list, and `community-ban HANDLE` takes down an author's whole catalogue and deactivates the account. Reports from users show in the admin console's report list (`target: module`). Authors upload with `scripts/release/community-publish.py`.

Run these from `website/`. The password is typed at a prompt, never given as an argument.

## Signing keys

The library only accepts signed releases (the rules are in [signing.md](../../website/content/developers/modules/signing.md)). Three values in `website/.env` tell it whom to trust and let it issue developer keys:

| Variable | What | Secret? |
|---|---|---|
| `BLEEP_ROOT_PUBLIC_KEYS` | The root **public** key (hex; two, comma separated, while a root is being replaced). The library checks every release against it, and the apps and plugins will carry the same key | No |
| `BLEEP_ISSUER_KEY` | The issuer's private key (PEM on one line, newlines written as `\n`). It issues developer keys | **Yes** |
| `BLEEP_ISSUER_CERT` | The issuer's certificate (JSON on one line), signed by the root | No |
| `BLEEP_COMMUNITY_KEY` | The library's community key (PEM on one line, newlines as `\n`), or `BLEEP_COMMUNITY_KEY_FILE` for a Docker secret. It signs the modules accounts upload, after the library has checked them. Made by `python -m app.cli community-init`; empty: community uploads are off | **Yes** |
| `BLEEP_COMMUNITY_CERT` | Its certificate (JSON on one line), issued by the issuer, modules only. Renew before it lapses (run `community-init` again and replace both lines): modules already published keep working through their receipts | No |

The root **private** key never goes into `website/.env` or onto the server. If the server is broken into, the attacker gets the issuer key, which the root can revoke and replace; the root key could not be replaced without updating every installed app. Keep it offline, in your keystore.

### 1. Create new keys

Do this for a new installation, or on purpose to replace all keys. **Do not do it on a site whose developers already have keys**: it creates a new root and issuer, every existing signing kit stops being valid, and apps built with the old root public key reject what you release afterwards.

1. **Make the keys** on a machine you trust. It needs Python's `cryptography` package (`pip install cryptography`):

```bash
scripts/release/signing.py init-registry ~/bleep-registry-keys
```

It writes `root.key` and `root.pub` (the root), `issuer.key` and `issuer.cert` (the issuer, valid for ten years) and `registry.env` (the three lines for `website/.env`). Do not set `BLEEP_KEY_PASSPHRASE` here: it would encrypt the issuer key and the API could not read it.

2. **Secure the root key.** Put `root.key` into your keystore, check that you can read it back, then delete it from `~/bleep-registry-keys`. Keep `root.pub` (it is public; the apps will be built with it).

3. **Give the library its part.** Append the three lines to the website config, restrict the file, then delete `registry.env` (it duplicates the issuer key). The first `echo` matters: if `website/.env` does not end with a newline, the first appended line would be glued to the last one (for example onto `S3_SECRET_KEY`, which also breaks the storage login) and the root key would never be read:

```bash
{ echo; cat ~/bleep-registry-keys/registry.env; } >> website/.env
```

```bash
chmod 600 website/.env
```

4. **Start (or restart) the API** so it reads them and applies the database migrations:

```bash
scripts/run/run-website.sh
```

5. **Check:**

```bash
curl -s localhost:8080/api/registry/roots
```

It must show your root public key and `"requireSignatures":true`. An empty `roots` list means the lines did not reach the container: look at `website/.env` for a missing newline between two variables (each `NAME=` must start its own line).

6. **Make a signing kit** for your own releases (the publisher `bleep` is ours; `--first-party` lets it sign ids without a namespace), and list the issued keys:

```bash
cd website && docker compose exec api python -m app.cli developer-create bleep --scopes module,plugin --first-party > ~/.bleep-signing-kit.json
```

```bash
chmod 600 ~/.bleep-signing-kit.json
```

```bash
docker compose exec api python -m app.cli developer-list
```

The kit is a signing key: back it up like the root key. It is valid for 365 days; make a new one before it expires or releases fail with "expired". For a developer outside the team, make a kit with their own publisher and a token that is bound to it, and hand both over privately:

```bash
docker compose exec api python -m app.cli developer-create acme --scopes module > acme.kit.json
```

```bash
docker compose exec api python -m app.cli token-create "acme" --publisher acme > acme.token
```

7. **Release** with `--kit`: see [release.md](release.md). `scripts/release/release.py ... --dry-run` with the kit checks it against the library first.

### 2. Reuse existing keys

For a site that already has keys: moving the stack to another machine, a new `website/.env`, a rebuilt server. **Nothing is generated; do not run `init-registry`.** Existing signing kits and release tokens keep working.

1. **Find the three values.** In the old `website/.env`, or in the `registry.env` of your first run (your backup). The root public key is also in `root.pub`. The root private key is not needed for this.
2. **Put them into the new `website/.env`** (all three, `BLEEP_REQUIRE_SIGNATURES` stays `true`), and restrict the file:

```bash
chmod 600 website/.env
```

3. **Restore the database** from your backup if you can (see Notes below). The `developers` table lists the keys that were issued and which are revoked. Signatures verify without it, since the chain inside each one proves it was issued by your issuer. But in a **new empty database**, `developer-list` is empty, and keys revoked earlier are no longer refused. There is no command yet to add or revoke a key the database does not know, so restore the database if any key was revoked. Release tokens live in the database too: restore it, or make new tokens.
4. **Start the API** (`scripts/run/run-website.sh`) and check that the library trusts your root:

```bash
curl -s localhost:8080/api/registry/roots
```

The key must be the one in `root.pub`.

5. **Check that the issuer matches the root** by letting an existing kit sign a dry run. A kit from the old site is checked against the library's roots before anything is built or uploaded:

```bash
scripts/release/release.py --all --level patch --registry http://localhost:8080 --kit ~/.bleep-signing-kit.json --dry-run
```

It prints `Signing as bleep (key …)`. "not signed by a trusted root" means `BLEEP_ROOT_PUBLIC_KEYS` is not the root that certified the issuer (wrong or mixed-up values). "expired" means the kit needs renewing: `developer-create` (the issuer certificate itself lasts ten years).

If you only have an old kit and lost the `.env`, you cannot recover the issuer key from the kit: the kit holds a developer key, not the issuer's. Without a backup of `issuer.key` the way forward is a new issuer certified by the root key from your keystore. That command does not exist yet (`init-registry` always makes a new root too); until it does, a lost issuer key means creating new keys as in section 1 and re-issuing every kit.

## Community modules

Anyone with an account can publish a module (see [Publishing a module](../../website/content/developers/modules/publishing.md)); the library checks it and signs it with its **community key**. This needs the signing keys above (root, issuer) and two more lines in `website/.env`. Without them uploads answer 503 and nothing else changes.

**Set up (once).** From `website/`:

```bash
(umask 077; docker compose exec -T api python -m app.cli community-init > community.env)
cat community.env >> .env && rm community.env
docker compose up -d api
```

`umask 077` is required: the command refuses to write a secret into a file other users can read. Check that `.env` ended with a newline before appending. `community-init` prints the key id and expiry on stderr and records the key in the `developers` table, so `developer-revoke KEY_ID` works on it. The key is a secret; a Docker secret works too (`BLEEP_COMMUNITY_KEY_FILE`).

**Renew before the certificate lapses** (365 days by default; `--days` up to 825). `python -m app.cli developer-list` shows the expiry of the `community` key. Run `community-init` again, replace both lines in `.env` and restart the API. Published modules keep working: their publication receipts date them inside the old certificate. After the certificate lapses and before you renew, uploads answer 503 ("community key is expired").

**Moderation.**

- Users report a module from the library; reports appear in the admin console with `target: module` (the id is the release id).
- Withdraw a release: `docker compose exec api python -m app.cli community-takedown AUTHOR/NAME VERSION`. It leaves the index and goes on the signed revocation list; apps pick it up the next time they look. The version number stays used.
- Remove an author: `community-ban HANDLE` takes down all their releases, deactivates the account and ends its sessions.
- If the community key itself leaks: `developer-revoke KEY_ID`, then `community-init`. Every community module stops loading until the author or you republish it, so do this only if you must.

**What to check after setup.** Upload a test module with a test account (`scripts/release/community-publish.py ... --check` first); it must show up in the library list with `trust: community`.

## Notes

- **Database password is fixed at first start.** Postgres keeps the password it was created with in the `db-data` volume. If you change `POSTGRES_PASSWORD` later, either change it inside Postgres or delete the volume: `docker compose down -v` (this deletes all accounts).
- **Back up the database** with `docker compose exec db pg_dump -U bleep bleep > backup.sql`.
- **Updates:** `git pull && scripts/run/run-website.sh`. The API applies database migrations when it starts.
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
