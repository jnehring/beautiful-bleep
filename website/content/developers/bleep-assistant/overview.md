---
title: Bleep Assistant
description: What the agentic Bleep Assistant is, what it can do, where its code lives, and a map of these pages.
order: 10
---

# Bleep Assistant

The **Bleep Assistant** is a chat window in the board in which an AI agent helps with a patch. It answers questions about Bleep, finds out why there is no sound, adds and wires modules, programs sequencers, builds panels and designs a sound from scratch. It is *agentic*: it does not just reply, it looks things up and acts through tools, step by step, until the request is done.

Two rules shape everything else:

- **The user stays in control.** Every change to the patch is a visible changeset that the board applies as one undo step. In *ask* mode the user approves it first; in *auto* mode it is applied at once, and destructive changes (removing a module, replacing a panel) still ask.
- **The model never writes raw patch JSON.** It calls typed operations ("add this module, connect these jacks"). The library checks each one against the module catalog before anything reaches the board, and a mistake comes back to the model as a message it can retry on.

## What it does

| Skill | Handles | Example |
|---|---|---|
| `docs` | Questions about using or extending Bleep, answered from the documentation with links | "What does Drive do in the Multi Filter?" |
| `diagnose` | Finds out why something is silent, by reading the patch and measuring signals, then fixes it | "Why do I not hear sound?" |
| `patch` | Small precise edits: insert effects on a cable, add a MIDI device, change a value | "Add chorus and reverb between the synth and the output" |
| `panel` | Builds or tidies a front panel | "Build a panel for this patch" |
| `compose` | Programs a sequencer | "Program an acid line in the step sequencer" |
| `design` | Builds a whole sound or instrument | "Build an acid synthesizer" |

The assistant is off by default. It is switched on in the website with `BLEEP_AGENT_ENABLED=true` and a provider key; see [Configuration](../setup/configuration.md) and `website/.env.example`.

## Where the code is

| Piece | Path |
|---|---|
| The library `bleep-agent` (Python 3.12, Pydantic AI) | `agent/src/bleep_agent/` |
| Backend integration (auth, rate limit, budget, streaming, run log) | `website/api/app/routers/agent.py`, `agent_quota.py`, `agent_log.py` |
| The chat panel in the board | `patch/board/ui/agent-chat.js`, `agent-chat.css` |
| The benchmark | `agent/evals/` and `agent/src/bleep_agent/evals/` |
| Generated data (git-ignored) | `website/api/agent_data/`: `catalog.json`, `presets.jsonl`, `docs.sqlite` |
| Formats and protocol, normative | `doc/specs/agent.md` |
| Goals and reasoning | `doc/agent-concept.md` |

The library has no FastAPI dependency, so it also runs from a command line, which is how the benchmark and local experiments use it:

```bash
.venv-agent/bin/bleep-agent chat "add chorus and reverb between the synth and the output" --preset additive-osc-tilt-sweep --model gemini-3.8-flash
```

## The pages

| Page | What it explains |
|---|---|
| [Architecture](architecture.md) | The pieces, how they talk, and what is kept where |
| [How a turn works](agent-flow.md) | One request from routing to events, with pause and resume for live tools |
| [Skills and tools](skills-and-tools.md) | Which tools each skill sees, and how the prompts are built to stay cheap |
| [Edits and changesets](edits-and-changesets.md) | The typed operations, validation, diagnosis without audio, and undo |
| [Documentation search](documentation-search.md) | How a docs question finds the right pages |
| [Benchmark and results](benchmark.md) | The 187-case benchmark, how a run is scored, and the results so far |

## Working on the assistant

Set up the library and build its data once:

```bash
python3 -m venv .venv-agent && .venv-agent/bin/pip install -e "agent[dev]"
PYTHON=.venv-agent/bin/python scripts/build/build-agent-data.sh
.venv-agent/bin/pytest agent/tests
```

Every change to a prompt, a tool or the catalog can change how the assistant behaves, so measure it: run the [benchmark](benchmark.md) before and after, and record the new version in the lab notebook.
