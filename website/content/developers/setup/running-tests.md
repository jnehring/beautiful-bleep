---
title: Running unit tests
description: How to run every test suite in the repository (C++ with CTest, Python with pytest and unittest, JavaScript with Node) and which one covers which part.
order: 10
---

# Running unit tests

The repository has one test suite per part. Run the ones for the part you changed; the setup for each is in [Developer setup](overview.md). All commands run from the repository root (`bleep-patch/`).

| I changed… | Run | Needs |
|---|---|---|
| DSP, a module, the engine | [Native tests (CTest)](#native-tests-ctest) | CMake, a C++ compiler |
| The bus library (`bus/`) | [Bus tests](#bus-tests) | CMake, a C++ compiler |
| Board UI or the web engine (`patch/web`) | [Bleep Play tests](#bleep-play-tests) | Node 22 |
| Bleep Script (`patch/script`) | [Bleep Script tests](#bleep-script-tests) | Node 22 |
| The website API (`website/api`) | [API tests](#website-api-tests) | Python 3 |
| The patch assistant (`agent/`) | [Agent tests](#agent-tests) | Python 3 |
| Release scripts (`scripts/release`) | [Release script tests](#release-script-tests) | Python 3, `cryptography` |

## Native tests (CTest)

The quick way compiles only `juce_core`, with no plugins and no plugin SDKs:

```bash
cmake -S patch -B build/light -G Ninja -DBLEEP_LIGHT_TESTS=ON
cmake --build build/light && ctest --test-dir build/light --output-on-failure
```

It runs the DSP, utility DSP and module tests. Run one test by name, for example `patch.dsp`:

```bash
ctest --test-dir build/light -R patch.dsp --output-on-failure
```

To also run the engine, bridge and plugin tests, use the full build, which compiles the plugins and runs `ctest` at the end:

```bash
scripts/build/build-patch.sh
```

## Bus tests

```bash
cmake -S bus -B build/bus -DCMAKE_BUILD_TYPE=Release
cmake --build build/bus --config Release
ctest --test-dir build/bus -C Release --output-on-failure
```

## Bleep Play tests

Plain Node scripts, one per area, without a test framework. A script exits non-zero when it fails. Some of them test the built site, so build it first (`scripts/build/build-web.sh --no-modules`).

```bash
node patch/web/test/library-client-test.mjs
node patch/web/test/board-code-test.mjs
node patch/web/test/graph-test.mjs build/web/site
```

The other files in `patch/web/test/` run the same way; the full list that CI runs is in `.github/workflows/ci.yml`. To run all of them, loop over the folder (the ones that need the built site take `build/web/site` as argument):

```bash
for t in patch/web/test/*-test.mjs; do node "$t" build/web/site || break; done
```

## Bleep Script tests

```bash
cd patch/script
npm ci --no-audit --no-fund
npm test
```

## Website API tests

pytest, with an in-memory SQLite database, so no Docker and no `.env` are needed:

```bash
python3 -m venv .venv-api && .venv-api/bin/pip install -r website/api/requirements-dev.txt
cd website/api && ../../.venv-api/bin/pytest
```

Run one file or one test with `pytest tests/test_registry.py` or `pytest -k login`.

## Agent tests

```bash
python3 -m venv .venv-agent && .venv-agent/bin/pip install -e "agent[dev]"
.venv-agent/bin/pytest agent/tests
```

The tests do not call a model API. The evaluation workbench (`bleep-agent eval run`) does, and costs money, so it is not part of the unit tests.

## Release script tests

```bash
python3 -m pip install cryptography
cd scripts/release && python3 -m unittest test_release test_signing test_package_module
```

## Repository rules

Not unit tests, but CI enforces them and they run in seconds:

```bash
python3 scripts/check/check-repo.py
python3 scripts/check/check-api-docs.py
```
