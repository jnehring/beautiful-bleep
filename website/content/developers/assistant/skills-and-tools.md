---
title: Skills and tools
description: The six skills, the tools each one is offered, and how the prompts and tool definitions are kept small and cache-friendly.
order: 40
---

# Skills and tools

A **skill** is a prompt section plus a subset of tools. One agent serves all six; the skill changes what it is told and what it can call. Skills are defined in `agent/src/bleep_agent/skills.py`, tools in `tools.py`, prompts in `prompts/`.

## Which skill sees which tools

| Skill | Read and lookup tools | Write tools | Live tools |
|---|---|---|---|
| `docs` | `describe_module`, `search_docs`, `read_doc` | none | none |
| `diagnose` | `describe_module`, `trace_signal`, `check_audibility` | `propose_changes` | `get_environment`, `probe_signals`, `highlight`, `ask_user` |
| `patch` | `describe_module`, `list_module_types`, `trace_signal`, `search_presets`, `get_preset` | `propose_changes` | `get_environment`, `highlight`, `ask_user` |
| `panel` | `describe_module`, `get_panel` | `build_panel`, `propose_panel` | `highlight` |
| `compose` | `describe_module`, `get_sequencer`, `search_presets`, `get_preset` | `propose_changes`, `set_pattern`, `set_drum_pattern` | `play`, `ask_user` |
| `design` | `describe_module`, `list_module_types`, `search_presets`, `get_preset`, `get_sequencer`, `get_panel`, `check_audibility` | `propose_changes`, `set_pattern`, `set_drum_pattern`, `build_panel`, `propose_panel` | `get_environment`, `probe_signals`, `play`, `highlight`, `ask_user` |

The table is not arbitrary. Every tool definition is sent on every model call, so a tool a skill never uses is pure cost; the split came from counting which tools were used in the benchmark's runs. The documentation tools belong to `docs` only, `list_module_types` to the skills that look for modules, `trace_signal` to those that follow cables.

## The tools

**Lookups** run against the catalog, the patch and the indexes:

| Tool | Does |
|---|---|
| `list_module_types(query, role, category)` | Finds module types, for example by role (`reverb`, `filter`) |
| `describe_module(type)` | Jacks with signal types, and each knob on one line with range, unit and choices |
| `trace_signal(from, to)` | Lists the cable paths between two modules |
| `check_audibility()` | Static and simulated diagnosis with structured findings and ready fixes; see [Edits and changesets](edits-and-changesets.md) |
| `search_presets`, `get_preset` | Finds and reads example patches to learn from |
| `get_panel`, `get_sequencer` | Reads a panel or a sequencer's steps |
| `search_docs`, `read_doc` | Searches the documentation and reads a page; see [Documentation search](documentation-search.md) |

**Writes** produce a changeset or an error text:

| Tool | Does |
|---|---|
| `propose_changes(ops, summary)` | A list of typed operations: add, remove, connect, set a knob, insert on a cable and so on |
| `set_pattern`, `set_drum_pattern` | Writes a step sequencer or drum grid; a short motif is tiled to the requested length |
| `build_panel(plan)` | The model picks which knobs go on a panel and how to group them; the library does the layout |
| `propose_panel` | Replaces a panel; refuses to drop a knob that is wired, so panels are rearranged, never trimmed |

**Live tools** run in the browser (see [How a turn works](agent-flow.md)):

| Tool | Does |
|---|---|
| `get_environment` | Audio state, MIDI devices, transport, keyboard modules |
| `probe_signals` | Listens at jacks, optionally while the browser plays a test note; returns whether a signal is present and moving |
| `play` | Plays notes, so the user hears a pattern |
| `highlight` | Points at modules, jacks or cables on the board |
| `ask_user` | One short question with choices |

## How the prompts are built

The shared `base.md` teaches how Bleep works: patches, signal types, that every knob is also a modulation input, the typical subtractive voice, what ports and cells are, and the working rules (look things up, add and wire in one call, make the smallest change, say plainly what changed, never claim a change you did not make). Each skill adds a short task section, for example the `diagnose` steps "run `check_audibility`, then measure, then walk the path backwards from the output".

Several choices keep the cost per request down, and each one was measured in the [benchmark](benchmark.md):

- **The board is in the instructions.** There is no `get_patch` tool; the current board, with the user's selection marked, is part of the instructions of every step, so the model never spends a call reading it and always sees its own changes.
- **A jacks-and-knobs sheet** for the twelve most used modules sits in the prompt, because looking those up was most of the `describe_module` calls.
- **Slim tool schemas.** The JSON schema of each tool is stripped of what the model does not need (titles, `default: null`, nullable wrappers). `propose_changes` alone is about 1,700 tokens, sent on every call.
- **Stable prefix first**, so provider prompt caches hit; for OpenAI each skill also gets its own prompt cache key so requests of one skill are routed together.
- **A bad value is a retryable tool error**, not the end of the run: a scale called "Minor" is read as the scale it means, an unknown knob returns the real ones.

## Adding a tool or a skill

1. Write the tool as a function in `tools.py` and add it to the right list (`READ`, `WRITE`, `SEQ`...). Keep its description short: it is paid for on every call.
2. Offer it in `skills.py` only to the skills that need it.
3. Add an `ACTIVITY` line in `runner.py` so the chat shows something while it runs.
4. Add benchmark cases that need it, run the [benchmark](benchmark.md) and record the version in the lab notebook.
