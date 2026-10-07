# Tools

| Script | Purpose |
|---|---|
| `build_docs.py` | single-file docs per audience + `llms.txt`; fails if a bundle exceeds ~80k tokens |
| `check_api_docs.py` | every function in `bleep_bus.h` has exactly one API reference entry |
| `ui_server.py` | serves one module's UI (its `ui/` over `common/ui/`) in a browser with a fake backend |
| `check_repo.py` | dependency rules between `bus/`, `patch/`, `website/`; SPDX headers; LICENSE files |
