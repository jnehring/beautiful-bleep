# Scripts

All build, run, check and release scripts of the repository, one folder per kind of work. Each script finds the
repository root itself and works from any directory. The main [README](../README.md#scripts) has the table with
what every script does and its options.

| Folder | For | Scripts |
|---|---|---|
| [`build/`](build/) | Building the bus, the plugins and the browser board | `build-bus.sh`, `build-patch.sh`, `build-web.sh` |
| [`run/`](run/) | Running things during development | `run-app.sh`, `reload-live.sh`, `run-website.sh`, `ui-server.py` |
| [`docs/`](docs/) | Generating documentation | `build-docs.py`, `module-screenshots.py` |
| [`check/`](check/) | Checks that CI runs | `check-repo.py`, `check-api-docs.py` |
| [`release/`](release/) | Signing and publishing to the library, with their tests | `release.py`, `signing.py`, `test_release.py`, `test_signing.py` |
| [`experiments/`](experiments/) | Spikes that are not part of the build | `wasm-spike.sh` |

A new script goes in the folder of what it is for; add a folder only when none fits. Paths to a script in docs, CI
and other scripts always include the folder (`scripts/build/build-patch.sh`), and a script reads the repository root
as its folder's grandparent, so moving one means changing that line too.
