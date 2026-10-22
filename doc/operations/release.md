# Release

## Releasing plugins to the library

`scripts/release/release.py` publishes plugins to the library in the website stack: `bleep-board`, the port plugins (`bleep-midi-in`, `bleep-midi-out`, `bleep-audio-in`, `bleep-audio-out`), `bleep-instrument`, `bleep-fx` and the standalone app `bleep-app` (`--list` shows them). The Audio Bridge is no longer on the list. Modules are not released this way yet.

**One-time: a release token.** An admin creates it on the website (Admin → Release tokens; shown once), or from the command line (it is shown once; put it in a file only you can read):

```bash
cd website
docker compose exec api python -m app.cli token-create "my laptop" --days 90 > ~/.bleep-release-token
docker compose exec api python -m app.cli token-list
docker compose exec api python -m app.cli token-revoke ID
```

A token releases for one publisher: without `--publisher` it is for our own releases (`bleep`); `token-create NAME --publisher acme` makes one for a developer.

**One-time: signing (the library refuses unsigned releases; `scripts/release/release.py` and `signing.py` need `pip install cryptography`).** Every file is signed with a developer key; the rules are in `website/content/developers/modules/signing.md`.

1. **Make the keys** on a trusted machine: `scripts/release/signing.py init-registry ~/bleep-registry-keys`. Move `root.key` to your keystore (and back it up), then delete the copy: the website never needs it.
2. **Give the library its part.** Append the three lines of `registry.env` (the root *public* key, the issuer key and its certificate) to `website/.env`, each on its own line (step-by-step in [website.md](website.md#signing-keys)), then `docker compose up -d api`. Without `BLEEP_ROOT_PUBLIC_KEYS` the library refuses every release (fail closed).
3. **Make a kit for the publisher** (our own: `bleep`, a first-party key that may sign ids without a namespace):

```bash
(umask 077; docker compose exec -T api python -m app.cli developer-create bleep --scopes module,plugin --first-party --confirm > ~/.bleep-signing-kit.json)
chmod 600 ~/.bleep-signing-kit.json
docker compose exec api python -m app.cli developer-list
docker compose exec api python -m app.cli developer-revoke KEY_ID
```

   The kit holds the private key and a certificate (valid 365 days by default; make a new one before you want to publish again once it has lapsed. Releases that are already published keep working: the library dated each one with a publication receipt, so nothing has to be re-signed). A developer outside the team gets their own kit and token: `developer-create acme --scopes module`, `token-create "acme" --publisher acme`, both handed over privately.
   Receipts make the library's clock a security input: keep the server's time synchronised (NTP). A clock that jumps back makes publishing fail (503) until it has caught up. Releases published before receipts existed get theirs once, with `docker compose exec api python -m app.cli receipts-backfill --dry-run` and then without `--dry-run`; it lists the files it cannot date, and those are signed again by their developers ([signing.md](../../website/content/developers/modules/signing.md), section 6a).
4. Tell the tools where the kit is, once: `"signingKit": "~/.bleep-signing-kit.json"` in `config/bleep.local.json` (git-ignored; copy `config/bleep.local.example.json`, which also takes `releaseTokenFile` and `registry`). `--kit` and `$BLEEP_SIGNING_KIT` override it. Then `./bleep release plugins --level patch` and `./bleep release modules --level patch` need no further options (modules are built, packaged and released in one go; unchanged ones are skipped).

**Release:**

1. Set up the build: `./bleep build plugins` (the script reads the artefacts in `build/patch`; `--build` runs that first).
2. Run, for one plugin, several, or all:

```bash
scripts/release/release.py bleep-board --level 1.x --registry http://localhost:8080 --token-file ~/.bleep-release-token --kit ~/.bleep-signing-kit.json
scripts/release/release.py --all --level patch --registry http://localhost:8080 --token-file ~/.bleep-release-token --kit ~/.bleep-signing-kit.json --dry-run
```

`--registry` and the token can also come from `BLEEP_REGISTRY_URL` and `BLEEP_RELEASE_TOKEN`. The token is never a command-line argument.

**Levels.** `--level` says what to count up, from the newest published version of each plugin:

| Level | Counts | Example (newest is 1.4.2) |
|---|---|---|
| `x` | the major | 2.0.0 |
| `1.x` | the minor within major 1 | 1.5.0 |
| `1.4.x` | the patch within 1.4 | 1.4.3 |
| `major`, `minor`, `patch` | the same, from the newest | 2.0.0, 1.5.0, 1.4.3 |

Each plugin has its own version counter. With nothing published yet, `x`, `0.x` and `0.0.x` give 0.1.0.

Other options: `--channel beta`, `--notes TEXT`, `--list`, `-y` (no confirmation), `--dry-run`. A dry run needs no token and changes nothing; with a kit it also checks the kit.

**What it does.** Before building anything it checks the kit against the library's root keys (a wrong or expired kit fails at once). It zips the build (named for this machine: `macos-arm64`, …), asks the API for the published versions, creates a draft release, uploads the zip (the server checks size and SHA-256), and publishes. Publishing writes `entry.json` and a new `v1/index.json` into the bucket; clients see the release when the index changes. Versions are immutable: a release is never overwritten, a fix is a new version.

**Not yet:** one release holds the builds of the machine that ran the script, so a Windows build is a separate run and needs a new version. The index is not signed yet and the zips are not code-signed or notarised (step 5 below stays manual). Combining platforms in one release is meant for CI.

## The manual release (until CI does it)

1. **Check main is green.** CI (`.github/workflows/ci.yml`) builds and tests the bus, the plugins (Linux, macOS, Windows), Bleep Play and the website.
2. **Set the version.** The product version is `project(BleepBoard VERSION …)` in `patch/CMakeLists.txt`; the plugins and the app take it from there. The bus has its own version in `bus/CMakeLists.txt` (it follows the spec version). Commit the bump.
3. **Tag.** `git tag plugin-vX.Y.Z && git push origin plugin-vX.Y.Z`.
4. **Take the build from CI.** The `plugins` job uploads `beautiful-bleep-macos-latest` and `beautiful-bleep-windows-latest` (VST3 and Standalone) as workflow artifacts. Download them from the run for the tag. To build locally instead, see [build-standalone-app.md](build-standalone-app.md) and `./bleep build plugins`.
5. **Sign for the operating system.** (The library signature above is separate and happens in `release.py`.) Not automated. macOS builds need a Developer ID signature and notarization to open without a Gatekeeper warning; Windows builds are unsigned. Do this before publishing.
6. **Publish.** Attach the signed files to a GitHub release for the tag, with the changelog, and release them to the library (above).
7. **Website.** Deployed by `.github/workflows/deploy.yml` after CI is green on `main` ([deploy.md](deploy.md)).

### Licence check before shipping the app

The app includes Ableton Link by default, which makes that binary GPL; the VST3 plugins do not include it. JUCE is AGPLv3 or commercial. `python3 scripts/check/check-repo.py` checks the repository's dependency and licence-header rules; CI runs it.

## Planned: the rest of the library

`website/content/developers/modules/library.md` specifies the full system. Built so far: the object storage, the release API, tokens, signed releases (`scripts/release/release.py`, `scripts/release/signing.py`, the library's checks) for plugins. Not built: module packages and releases, a signed index and revocation list, staging, presets.
