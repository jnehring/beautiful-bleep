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
| `BLEEP_ROOT_PUBLIC_KEYS`, `BLEEP_ISSUER_KEY`, `BLEEP_ISSUER_CERT` | The registry's signing keys (see [Signing keys](#signing-keys)). Without the root public key the registry refuses every release |
| `BLEEP_REQUIRE_SIGNATURES` | Default `true`: a release without a valid developer signature is refused. Only turn it off for local experiments |

Then start it:

```bash
scripts/run/run-website.sh          # or: cd website && docker compose up --build -d
```

Open http://localhost:8080. The image build takes about a minute: it contains the site, the docs and the board's UI, but **not the board's WebAssembly modules**. Those are built on the host and mounted into the site container (read-only), so changing the site never recompiles them:

```bash
scripts/build/build-web.sh --docker --modules-only   # in the Emscripten Docker image: no local emsdk needed
scripts/build/build-web.sh --modules-only            # or with a local Emscripten SDK (emcc on the PATH)
```

The first run compiles every module (slow; on Apple Silicon the image runs emulated). Later runs rebuild only the modules whose files changed (the compiler's dependency list is hashed in `build/web/modules/.cache/`); an unchanged run takes seconds. To force a full rebuild, delete `build/web/modules/.cache`. `BLEEP_WEB_ONLY=oscillator,filter` builds just those and keeps the rest of the manifest.

Without `build/web/modules`, the site runs but the Bleep Board at `/board/` has no modules. `BLEEP_WEB_MODULES` in `website/.env` points compose at another folder. (This is temporary: modules will come from the registry.)

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

Release tokens for `scripts/release/release.py` come from the same console: `token-create NAME [--days N] [--publisher P]`, `token-list`, `token-revoke ID`; developer signing keys with `developer-create`, `developer-list`, `developer-revoke` (see [release.md](release.md); the keys the registry needs are `BLEEP_ROOT_PUBLIC_KEYS`, `BLEEP_ISSUER_KEY` and `BLEEP_ISSUER_CERT` in `website/.env`).

Run these from `website/`. The password is typed at a prompt, never given as an argument.

## Signing keys

The registry only accepts signed releases (the rules are in [signing.md](../specs/signing.md)). Three values in `website/.env` tell it whom to trust and let it issue developer keys:

| Variable | What | Secret? |
|---|---|---|
| `BLEEP_ROOT_PUBLIC_KEYS` | The root **public** key (hex; two, comma separated, while a root is being replaced). The registry checks every release against it, and the apps and plugins will carry the same key | No |
| `BLEEP_ISSUER_KEY` | The issuer's private key (PEM on one line, newlines written as `\n`). It issues developer keys | **Yes** |
| `BLEEP_ISSUER_CERT` | The issuer's certificate (JSON on one line), signed by the root | No |

The root **private** key never goes into `website/.env` or onto the server. If the server is broken into, the attacker gets the issuer key, which the root can revoke and replace; the root key could not be replaced without updating every installed app. Keep it offline, in your keystore.

### 1. Create new keys

Do this for a new installation, or on purpose to replace all keys. **Do not do it on a site whose developers already have keys**: it creates a new root and issuer, every existing signing kit stops being valid, and apps built with the old root public key reject what you release afterwards.

1. **Make the keys** on a machine you trust. It needs Python's `cryptography` package (`pip install cryptography`):

```bash
scripts/release/signing.py init-registry ~/bleep-registry-keys
```

It writes `root.key` and `root.pub` (the root), `issuer.key` and `issuer.cert` (the issuer, valid for ten years) and `registry.env` (the three lines for `website/.env`). Do not set `BLEEP_KEY_PASSPHRASE` here: it would encrypt the issuer key and the API could not read it.

2. **Secure the root key.** Put `root.key` into your keystore, check that you can read it back, then delete it from `~/bleep-registry-keys`. Keep `root.pub` (it is public; the apps will be built with it).

3. **Give the registry its part.** Append the three lines to the website config, restrict the file, then delete `registry.env` (it duplicates the issuer key). The first `echo` matters: if `website/.env` does not end with a newline, the first appended line would be glued to the last one (for example onto `S3_SECRET_KEY`, which also breaks the storage login) and the root key would never be read:

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

7. **Release** with `--kit`: see [release.md](release.md). `scripts/release/release.py ... --dry-run` with the kit checks it against the registry first.

### 2. Reuse existing keys

For a site that already has keys: moving the stack to another machine, a new `website/.env`, a rebuilt server. **Nothing is generated; do not run `init-registry`.** Existing signing kits and release tokens keep working.

1. **Find the three values.** In the old `website/.env`, or in the `registry.env` of your first run (your backup). The root public key is also in `root.pub`. The root private key is not needed for this.
2. **Put them into the new `website/.env`** (all three, `BLEEP_REQUIRE_SIGNATURES` stays `true`), and restrict the file:

```bash
chmod 600 website/.env
```

3. **Restore the database** from your backup if you can (see Notes below). The `developers` table lists the keys that were issued and which are revoked. Signatures verify without it, since the chain inside each one proves it was issued by your issuer. But in a **new empty database**, `developer-list` is empty, and keys revoked earlier are no longer refused. There is no command yet to add or revoke a key the database does not know, so restore the database if any key was revoked. Release tokens live in the database too: restore it, or make new tokens.
4. **Start the API** (`scripts/run/run-website.sh`) and check that the registry trusts your root:

```bash
curl -s localhost:8080/api/registry/roots
```

The key must be the one in `root.pub`.

5. **Check that the issuer matches the root** by letting an existing kit sign a dry run. A kit from the old site is checked against the registry's roots before anything is built or uploaded:

```bash
scripts/release/release.py --all --level patch --registry http://localhost:8080 --kit ~/.bleep-signing-kit.json --dry-run
```

It prints `Signing as bleep (key …)`. "not signed by a trusted root" means `BLEEP_ROOT_PUBLIC_KEYS` is not the root that certified the issuer (wrong or mixed-up values). "expired" means the kit needs renewing: `developer-create` (the issuer certificate itself lasts ten years).

If you only have an old kit and lost the `.env`, you cannot recover the issuer key from the kit: the kit holds a developer key, not the issuer's. Without a backup of `issuer.key` the way forward is a new issuer certified by the root key from your keystore. That command does not exist yet (`init-registry` always makes a new root too); until it does, a lost issuer key means creating new keys as in section 1 and re-issuing every kit.

## Notes

- **Database password is fixed at first start.** Postgres keeps the password it was created with in the `db-data` volume. If you change `POSTGRES_PASSWORD` later, either change it inside Postgres or delete the volume: `docker compose down -v` (this deletes all accounts).
- **Back up the database** with `docker compose exec db pg_dump -U bleep bleep > backup.sql`.
- **Updates:** `git pull && scripts/run/run-website.sh`. The API applies database migrations when it starts.
- **HTTPS:** the Caddyfile serves plain HTTP on port 80. For a public site put TLS in front (or change the site address in the Caddyfile so Caddy gets a certificate) and set `BLEEP_COOKIE_SECURE=true`.
- There is no login rate limiting, email verification or password reset yet.
