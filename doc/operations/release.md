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

A token releases for one publisher: without `--publisher` it is for our own releases (`bleep`); `token-create NAME --publisher acme` makes one for a developer. Nothing in a release is signed: the token decides who may release under which publisher name. Put `releaseTokenFile` and `registry` into `config/bleep.local.json` (git-ignored; copy `config/bleep.local.example.json`) once, then `./bleep release plugins --level patch` and `./bleep release modules --level patch` need no further options (modules are built, packaged and released in one go; unchanged ones are skipped).

**Release:**

1. Set up the build: `./bleep build plugins` (the script reads the artefacts in `build/patch`; `--build` runs that first).
2. Run, for one plugin, several, or all:

```bash
scripts/release/release.py bleep-board --level 1.x --registry http://localhost:8080 --token-file ~/.bleep-release-token
scripts/release/release.py --all --level patch --registry http://localhost:8080 --token-file ~/.bleep-release-token --dry-run
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

Other options: `--channel beta`, `--notes TEXT`, `--list`, `-y` (no confirmation), `--dry-run`. A dry run needs no token and changes nothing.

**What it does.** It zips the build (named for this machine: `macos-arm64`, …), asks the API for the published versions, creates a draft release, uploads the zip (the server checks size and SHA-256), and publishes. Publishing writes `entry.json` and a new `v1/index.json` into the bucket; clients see the release when the index changes. Versions are immutable: a release is never overwritten, a fix is a new version.

**Not yet:** one release holds the builds of the machine that ran the script, so a Windows build is a separate run and needs a new version. The zips are not code-signed or notarised (step 5 below stays manual). Combining platforms in one release is meant for CI.

## The manual release (until CI does it)

1. **Check main is green.** CI (`.github/workflows/ci.yml`) builds and tests the bus, the plugins (Linux, macOS, Windows), Bleep Play and the website.
2. **Set the version.** The product version is `project(BleepBoard VERSION …)` in `patch/CMakeLists.txt`; the plugins and the app take it from there. The bus has its own version in `bus/CMakeLists.txt` (it follows the spec version). Commit the bump.
3. **Tag.** `git tag plugin-vX.Y.Z && git push origin plugin-vX.Y.Z`.
4. **Take the build from CI.** The `plugins` job uploads `beautiful-bleep-macos-latest` and `beautiful-bleep-windows-latest` (VST3 and Standalone) as workflow artifacts. Download them from the run for the tag. To build locally instead, see [build-standalone-app.md](build-standalone-app.md) and `./bleep build plugins`.
5. **Sign for the operating system.** Not automated. macOS builds need a Developer ID signature and notarization to open without a Gatekeeper warning; Windows builds are unsigned. Do this before publishing.
6. **Publish.** Attach the signed files to a GitHub release for the tag, with the changelog, and release them to the library (above).
7. **Website.** Deployed by `.github/workflows/deploy.yml` after CI is green on `main` ([deploy.md](deploy.md)).

### Licence check before shipping the app

The app includes Ableton Link by default, which makes that binary GPL; the VST3 plugins do not include it. JUCE is AGPLv3 or commercial. `python3 scripts/check/check-repo.py` checks the repository's dependency and licence-header rules; CI runs it.

## Planned: the rest of the library

`website/content/developers/modules/library.md` specifies the full system. Built so far: the object storage, the release API, tokens, releases (`scripts/release/release.py`, the library's checks) for plugins. Not built: staging, presets.
