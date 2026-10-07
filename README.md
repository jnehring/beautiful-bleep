# Bleep

Modular-style control for Ableton Live, built on an open protocol.
Everything in this repository is MIT-licensed.

| Folder | What | Start here |
|---|---|---|
| [`bus/`](bus/) | **Bleep Bus**: the open standard. C library, C++/JUCE helpers, examples, conformance suite | [Quickstart](website/content/developers/quickstart.md) |
| [`patch/`](patch/) | **Bleep Patch**: the modules (Function, Random, Utility, Filter, MIDI Out); each has `dsp/` and `ui/` | [Getting started](website/content/users/getting-started.md) |
| [`website/`](website/) | The Bleep Patch homepage and **all documentation** (`website/content/`) | [Spec v0.1](website/content/spec/v0.1/00-overview.md) |
| [`tools/`](tools/) | Docs generator (single-file docs, `llms.txt`) and repository checks | |

```bash
bus/build.sh                                  # the bus + conformance suite
patch/build.sh --juce /path/to/JUCE           # the modules as VST3 + Standalone
docker compose -f website/docker-compose.yml up --build -d   # the site on :8080
```

Or everything at once: `cmake -S . -B build -DBLEEP_JUCE_DIR=/path/to/JUCE && cmake --build build && ctest --test-dir build`.

Status: **v0.1, experimental.** The bus layout may change with every 0.x
release.

Dependency rules (checked in CI by `tools/check_repo.py`): `bus/` depends on
nothing else here; `patch/` uses the bus only through its public API; nothing
depends on `website/`.
