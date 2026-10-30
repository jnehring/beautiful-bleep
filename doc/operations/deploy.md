# Continuous integration and deployment

Four workflows in `.github/workflows/` (the fourth, `dev.yml`, builds and releases dev builds: [dev-builds.md](dev-builds.md)):

| Workflow | Runs | Where | What |
|---|---|---|---|
| `ci.yml` | every push to `main`, every pull request | GitHub-hosted runners (free: the repository is public) | repository rules, tests, the website image, Bleep Play, the plugins on Linux, macOS and Windows |
| `deploy.yml` | every push to `main` (while `ci.yml` is manual-only); manually on `main` | self-hosted runner on the server | rebuilds and restarts the website stack, waits for the API |
| `release.yml` | manually (Actions tab → Run workflow, with the version level) | GitHub-hosted runners | builds the plugins on macOS, Windows and Linux and releases them to the library; the macOS job publishes the version, the others add their platform |

No Windows server is needed: the Windows and macOS builds come from GitHub's `windows-latest` and `macos-14` runners. The builds are not code-signed (Authenticode, Apple notarization).

## One-time: the deploy runner on the server

The runner connects out to GitHub, so the server needs no open port and GitHub holds no SSH key.

1. **A user for it**, in the `docker` group, not root: `sudo adduser --disabled-password gh-runner && sudo usermod -aG docker gh-runner`. Docker, Docker Compose v2 and `git` must be installed.
2. **Register the runner:** repository → Settings → Actions → Runners → New self-hosted runner → Linux. Follow the commands it shows as `gh-runner`, and when `config.sh` asks for labels add `bleep-server`. Then install it as a service: `sudo ./svc.sh install gh-runner && sudo ./svc.sh start`.
3. **The secrets file.** `deploy.yml` copies the server's `website/.env` into each checkout; it is not in the repository. Put it where only the runner user can read it (the default is `/etc/bleep/website.env`; the repository variable `BLEEP_ENV_FILE` changes it):

```bash
sudo install -d -m 750 -o gh-runner /etc/bleep
sudo install -m 600 -o gh-runner website/.env /etc/bleep/website.env   # from your existing, working .env
```

   Production needs `BLEEP_COOKIE_SECURE=true`, `BLEEP_PUBLIC_URL` and, for automatic HTTPS, `BLEEP_SITE_ADDRESS` (see [website.md](website.md)).
4. **Protect it** (Settings):
   - Actions → General → *Fork pull request workflows*: **Require approval for all outside collaborators**. A self-hosted runner executes the code of the workflow that runs on it; `deploy.yml` only runs for `main`, but keep it that way.
   - Branches → protect `main` (require the CI checks), so that only reviewed, green code gets deployed.
5. **The first deploy:** Actions → Deploy → Run workflow (on `main`). Afterwards every push to `main` deploys.

The stack keeps its volumes (database, library storage, certificates) between deploys; the API runs its database migrations (`alembic upgrade head`) every time it starts. Take a database backup before a migration that drops data.

If a deploy fails, the job prints `docker compose ps` and the last log lines. The old containers are replaced one by one by `up -d`, so a failed build leaves the running site untouched; a started-but-unhealthy API does not roll back by itself: fix forward or re-run the Deploy workflow on the last good commit (Actions → Deploy → Run workflow does the current `main`; to go back, revert on `main`).

## Releasing plugins

See [release.md](release.md). One-time setup of `release.yml`: Settings → Environments → New environment `release` (required reviewers), with the variable `BLEEP_REGISTRY_URL` (the website's https address) and the secret `BLEEP_RELEASE_TOKEN`. Run it, enter the level (`patch`, `1.x`, …), approve the environment. The Linux binaries (VST3 and standalone) are built by the second job and added to the same version.

## Not covered

- Code signing and notarization of the macOS and Windows builds (unsigned for now).
- Testing in Ableton Live: CI cannot do that.
- Website backups.
