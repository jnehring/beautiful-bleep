# Dev builds

Every push to `main` is tested, built and released into the **dev channel** of the library. You install the result from Bleep App a few minutes later, instead of building everything on your own computer. A running Ableton Live can take a new version of a **module** without a restart.

## How it flows

`.github/workflows/dev.yml`:

| Job | Where | What |
|---|---|---|
| `server` | the build runner on the Linux server (label `bleep-build`, a container: `ci/runner`) | JS and preset tests, the native tests, the modules (WebAssembly; the same on every system), then the Linux plugins and app. Releases the modules and the plugins into the dev channel. |
| `other-systems` | GitHub-hosted `macos-14` and `windows-latest` | builds the plugins (and the app) and adds its platform to the release the server made for the same commit |

The jobs do not talk to each other except through the library: the macOS and Windows jobs find the release by its build time.

## Versions

A dev build is `1.4.4-dev.202610271432`: the next patch after the newest public version of that plugin or module, and the **build time** (UTC, `YYYYMMDDHHMM`). The build time is the time of the commit, so every machine that builds the commit arrives at the same version, and a re-run is a no-op.

- A dev build ranks above the release of its number (`1.4.4-dev.…` is newer than `1.4.4`), and dev builds rank among themselves by build time: of two `1.3-dev` builds the later is the newer.
- Modules that did not change since their newest version (dev or release) are not released again.
- The library keeps the newest 20 dev builds of each plugin and module.
- `./bleep package` (a module on your own computer) makes `1.4.4-dev.<now>` the same way, so your local copy wins until CI has a newer one.

By hand: `./bleep release plugins --dev`, `./bleep release modules --dev`, `./bleep release plugins --dev --add-platform` (see [release.md](release.md)).

## Who may use it

Dev builds are not public. They live in the bucket under `dev/` which `/registry/` does not serve (Caddyfile); the API hands them out at `/api/registry/dev/v1/…` to signed-in accounts that have **dev access** (admins always do). The public `index.json`, the library pages and the version list never show them.

- **Give access:** website → Admin → Release tokens → *Dev channel*, or `docker compose exec api python -m app.cli dev-access EMAIL` (`dev-revoke` takes it away).
- **Use it:** sign in in Bleep App (Account), then Settings → Library → Channel: **dev**. Optionally switch on *Install module updates automatically*: every minute the app looks for newer module versions and installs them; the running boards recompile, and the nodes of an updated module continue with the new version and their settings (a module's internal state, a delay line say, starts over). Plugins in Live share the setting and the modules with the app.
- Plugins (the VST3 binaries) cannot be swapped in a running Live: quit Live, then **Install plugins** in Bleep App.
- Back to stable: set the channel to stable. An installed dev module stays until the stable channel offers a newer number; remove it in the Library to go back.

## One-time setup

1. **The build runner** is a container (`ci/runner`) with the whole toolchain inside: Emscripten, JUCE, CMake, Node, the Linux libraries. It is **ephemeral**: it takes one job and is deleted, and docker compose starts a fresh one. It has no Docker socket, no host folders, no capabilities, and CPU and memory limits; only a compiler cache volume survives between jobs. A job (which compiles other people's code) therefore cannot reach the server, the website stack or the deploy runner. Docker and Docker Compose v2 are all the server needs.

   ```bash
   cd ci/runner
   cp .env.example .env     # REPO=owner/name, GITHUB_PAT=a fine-grained token for this repository only, "Administration: Read and write"
   chmod 600 .env
   docker compose up -d --build
   ```

   The token only registers runners; the entrypoint removes it from the environment before the job starts. Rebuild the image (`docker compose build --pull --no-cache`) every month or two: the build takes the latest runner release, and GitHub refuses runners below its minimum version (pin one with `--build-arg RUNNER_VERSION=x.y.z`). Several jobs at once: `docker compose up -d --scale runner=2` (the workflow runs one build at a time anyway).

   The deploy runner of [deploy.md](deploy.md) (label `bleep-server`, needs the Docker socket to restart the website) stays separate on the host and only ever runs `deploy.yml`.
2. **A dev-only release token** (cannot touch `stable` or `beta`):

   ```bash
   docker compose exec api python -m app.cli token-create ci-dev --channels dev
   ```

3. **GitHub:** Settings → Environments → New environment `dev` (no required reviewers: this runs by itself) with the variable `BLEEP_REGISTRY_URL` (the website's https address) and the secret `BLEEP_DEV_TOKEN`.
4. **Deploy the website once** (the migration `0018` adds the channel, and the Caddyfile hides `/registry/dev/`).

The token only reaches the release steps, not the build steps, which compile other people's code (JUCE, Link). Do not let pull requests from forks run on the self-hosted runners (see deploy.md).

## What is not covered

- Only `main` triggers it; run it for another branch with Actions → Dev build → Run workflow.
- `ci.yml` (all checks on the GitHub runners) still runs by hand. The gate of the dev build is `./bleep test js presets native`; the repository rules (`./bleep test check`) and the script tests fail at the moment (existing problems, listed by `./bleep test check py script`) and are not part of it yet.
- Builds are not code-signed or notarised.
