# Scripts

Everything for building, running, testing and releasing goes through one command at the repository root, `./bleep`
(`scripts/bleep.py`). `./bleep --help` lists the commands; `./bleep <command> --help` their options. The main
[README](../README.md#scripts) has the table.

**Settings** are read by `settings.py`, later layers winning: `config/bleep.json` (shared defaults, committed), then
`config/bleep.local.json` (this machine's: `signingKit`, `releaseTokenFile`, `registry`, `juceDir`, `liveSet`, `webDocker`,
git-ignored; start from `config/bleep.local.example.json`), then the environment (`BLEEP_JUCE_DIR`, `BLEEP_SIGNING_KIT`,
`BLEEP_RELEASE_TOKEN`, `BLEEP_REGISTRY_URL`, ...), then the command line. `./bleep config` prints the result. Secrets stay in
the files the settings name; the config holds paths only.

| Folder | For |
|---|---|
| `bleep.py`, `settings.py` | The command and its settings; their tests are in `tests/` |
| [`build/`](build/) | `build-web.sh`: the browser build (modules as `.wasm`, board UI, web engine); it also runs inside the Emscripten image, so it stays a shell script. Use `./bleep build web\|modules` |
| [`run/`](run/) | `ui-server.py`: the board UI against a fake engine (`./bleep run ui`) |
| [`docs/`](docs/) | `build-docs.py`, `build-help-index.py`, `module-screenshots.py` (`./bleep docs`) |
| [`check/`](check/) | `check-repo.py`, `check-api-docs.py`, `account-live.py` (`./bleep check`) |
| [`release/`](release/) | `release.py`, `package-module.py`, `signing.py`, `community-publish.py`, with their tests (`./bleep release`, `package`) |
| [`experiments/`](experiments/) | `wasm-spike.sh`: a spike that is not part of the build |

A new tool goes in the folder of what it is for and gets a subcommand in `bleep.py`; the tools find the repository root as their
folder's grandparent, so moving one means changing that line too.
