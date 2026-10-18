---
title: Benchmark and results
description: The assistant benchmark (187 cases, six skills, simulated browser, deterministic checks), how to run and compare it, and the results of the versions so far.
order: 70
---

# Benchmark and results

Prompts and tools change how the assistant behaves in ways that are hard to predict, so every change is measured. The **benchmark** runs a fixed set of requests against the real agent loop and scores each result by code. The numbers on this page come from the report that `bleep-agent eval compare` writes to `agent/evals/runs/compare.md`. That file is generated and git-ignored; the results below are a snapshot of it from **2026-10-18** (five versions) and are not updated by a build.

![Cases run through a harness that calls the real agent loop with a simulated browser, with every model call going through a replay cache. Checks in code and an optional judge model score each run. Results and full logs go to a run folder. The lab notebook lists versions of the assistant with their run folders, and the compare command writes compare.md.](/img/assistant-benchmark.svg)

## What is measured

A **case** is one user request on a known board, with checks that define success. There are **187 cases** in six groups, one per skill, kept as YAML in `agent/evals/cases/<skill>/`:

| Skill | Cases | How the cases are made | Example of what must hold |
|---|---|---|---|
| `docs` | 32 | Hand-written from the documentation, including 8 whose answer is *not* in it | The right page is cited and the key fact stated; for the unanswerable ones the assistant says it does not know |
| `diagnose` | 45 | Generated: a working preset is **damaged on purpose** (cable removed, module muted, knob closed, transport stopped) and kept only if the graph model confirms the damage silenced it | The assistant names the cause and its changes make the patch audible again, with few unrelated changes |
| `patch` | 40 | Generated from templates over the presets: insert effects, wire an LFO to the cutoff, add a MIDI keyboard, change a value | The cables exist, the effects are in the requested order before the output, the patch is valid |
| `panel` | 25 | Generated: build a panel, or organise a scrambled one | Every wired knob is on a panel, and the panel is valid |
| `compose` | 25 | Generated: melodies, bass lines, drum patterns with requested length, range and feel | A pattern of the right length, pitch span and gate count, with a repeating motif and ties where asked |
| `design` | 20 | Generated: build a sound from an empty board | A connected chain from a source through a filter and a VCA to the output |

Each case also has a **difficulty** (58 easy, 99 medium, 30 hard) and tags.

### A run, and what counts as success

The harness (`evals/harness.py`) runs a case the way a user would, with the browser **simulated**:

1. Load the board, apply the damage if any, send the request.
2. Run the real agent loop. Every changeset is applied to a copy of the board, as if the user approved it.
3. When the model calls a live tool, the simulated client answers it from the graph model: `probe_signals` reports from the simulation, `get_environment` reports a running audio engine, `ask_user` picks the first choice. The run is resumed, up to six times.
4. Run the **checks** on the final board, the changesets, the tool calls and the answer text.

A run is a **success** only if every check passes and there was no error. The checks are code, not opinion: `audible`, `fixes_fault`, `unrelated_changes`, `cable`, `has_path`, `fx_before_output`, `param_range`, `layout`, `module_added`, `valid_patch`, `no_state_change` (a question must not change the patch), `text_contains`, `cites`, `says_unknown`, `tool_used`, `panel_valid`, `panel_covers`, `pattern`.

An **optional judge** (`--judge <model>`) scores the answer 1 to 5 against a rubric in `evals/rubrics/` for what code cannot decide, such as musical quality or faithfulness to the docs. The judge is a pinned model with a fixed rubric and a structured verdict, and it sees the ground truth as context. The results below were run without a judge, so they measure what code can check.

### Reproducible and cheap to repeat

Every model, judge and embedding call goes through a content-addressed cache (`.eval-cache/`, modes `use`, `refresh`, `replay-only`, `off`). The key is the model, the repeat index, the messages, the tool definitions and the settings. An unchanged rerun costs nothing and reproduces its numbers; a changed prompt re-runs only the calls that depend on it. A replayed call keeps its **recorded latency**, so speed figures stay meaningful. Cost figures use a price table (`evals/prices.yaml`) and count provider-cached input tokens at their lower price.

Every run is also logged in full under `<run>/logs/<model>/<skill>/<case>.r<n>.json` and `.md`: the transcript, every model call with the messages sent, every tool call with arguments and result, and timestamps. It is the same shape as the chat's **Copy chat** export, and `logs/index.md` lists them. Reading the log of a failed case is how most fixes started.

## Running it

```bash
.venv-agent/bin/bleep-agent eval generate                    # regenerate evals/cases/*/generated.yaml
.venv-agent/bin/bleep-agent eval run --models gpt-6-luna --repeats 1
.venv-agent/bin/bleep-agent eval report agent/evals/runs/<run>
.venv-agent/bin/bleep-agent eval retrieval --embed gemini-embedding-2   # documentation search on its own
```

A full run calls a paid model API for every uncached case: 187 cases at one repeat is about 600 model calls. Use `--skills docs` or `--limit 5` for a smoke test first, and `--cache replay-only` in CI, where a missing call fails instead of spending money.

## Versions and the lab notebook

`agent/evals/lab-notebook.json` lists every version of the assistant that was benchmarked, oldest first: a name, the run folder of its benchmark and what changed since the previous version. The first entry is the baseline. Add an entry whenever you benchmark a new version.

```bash
.venv-agent/bin/bleep-agent eval compare                      # all versions in the notebook
.venv-agent/bin/bleep-agent eval compare --versions 1,3       # some of them
.venv-agent/bin/bleep-agent eval compare "Before=agent/evals/runs/<a>" "After=agent/evals/runs/<b>"
```

The report is compared on the **cases every run contains**, so a version is not flattered by cases the others never saw (`--all-cases` includes the rest). A version whose folder has no results yet is skipped.

## Results

All runs so far used one model, **gpt-6-luna**, one repeat, no judge, on the same 187 cases. Five versions have been benchmarked.

| # | Version | Success | Δ | Check score | Cost / request | Tokens in / out per request | Model calls / request | Latency p50 / p95 |
|---|---|---|---|---|---|---|---|---|
| 1 | First implementation | 74% (68%-80%) | | 0.91 | $0.0015 | 21,513 / 827 | 3.7 | 11.5s / 46.1s |
| 2 | Quick Wins | 90% (85%-93%) | +16 pp | 0.96 | $0.0015 | 21,007 / 760 | 3.6 | 11.8s / 35.4s |
| 3 | Motif tiling & lean lookups | 91% (87%-95%) | +17 pp | 0.97 | $0.0016 | 21,232 / 811 | 3.4 | 11.8s / 39.8s |
| 4 | Lean tools & citations | 93% (88%-96%) | +19 pp | 0.97 | $0.0015 | 19,195 / 828 | 3.4 | 10.3s / 39.0s |
| 5 | Flow layout | 94% (89%-96%) | +19 pp | 0.97 | $0.0015 | 19,236 / 770 | 3.2 | 9.5s / 30.5s |

The ranges are 95% confidence intervals (Wilson). With 187 runs they are about ±4 points, so only the jump from version 1 to 2 is clearly real. From version 2 onwards the steps are 1 to 3 points and the intervals overlap: the later versions are better than version 1, but the benchmark cannot rank them against each other.

**Cost.** Every run is now priced with the provider's prompt cache accounted for (about half of the input tokens are cache hits), so the costs of all five versions are comparable. Cost per *request* is flat at about $0.0015; cost per *success* fell from $0.0021 to $0.0016 only because more requests succeed. One whole benchmark costs about **$0.28 without any cache** (a fresh run of version 5 cost $0.2757). Model time fell from 54 minutes to 42; at concurrency 4 a fresh run takes about 10 minutes of wall time.

**Tokens and speed.** Input tokens fell 11% at version 4, when each skill was offered only its own tool definitions and the schemas were slimmed, and have stayed there. Calls per request fell from 3.7 to 3.2, p50 latency from 11.5 s to 9.5 s and p95 from 46 s to 30.5 s. Input is still about 19,000 tokens per request because each of the 3 to 4 calls repeats the instructions (prompt, module index, the board); that is why prompt caching matters more than shorter prompts.

### By skill

Success rate, 187 runs per version.

| Skill | Cases | 1 | 2 | 3 | 4 | 5 | Δ 1 to 5 |
|---|---|---|---|---|---|---|---|
| compose | 25 | 68% | 68% | 84% | 96% | 88% | +20 pp |
| design | 20 | 80% | 100% | 100% | 100% | 100% | +20 pp |
| diagnose | 45 | 84% | 96% | 98% | 98% | 96% | +11 pp |
| docs | 32 | 62% | 78% | 81% | 78% | 81% | +19 pp |
| panel | 25 | 56% | 92% | 92% | 84% | 96% | +40 pp |
| patch | 40 | 85% | 100% | 92% | 100% | 100% | +15 pp |

### By difficulty

| Difficulty | Cases | 1 | 2 | 3 | 4 | 5 | Δ 1 to 5 |
|---|---|---|---|---|---|---|---|
| easy | 58 | 93% | 95% | 93% | 97% | 95% | +2 pp |
| medium | 99 | 68% | 91% | 90% | 90% | 95% | +27 pp |
| hard | 30 | 60% | 77% | 93% | 97% | 87% | +27 pp |

The gains are in the medium and hard cases; the easy ones were already solved.

### What each version changed

**Version 1 to 2 (+16 pp).** Most of the gain came from fixing the assistant and the benchmark where they disagreed with reality, not from a better model:

- an `unmute` operation, so five muted-module diagnose cases pass (`set_node_data` refuses `muted`),
- embedded sample audio left out of the board snapshot (boards with a sample were refused as too large),
- the board in the instructions and no `get_patch` calls,
- panels are rearranged and never trimmed (11 `panel_covers` failures became 2),
- "Minor", "Aeolian" and "Ionian" understood as the scale they mean,
- unanswerable docs questions now say so (`says_unknown`: 8 failures became 2).

**Version 2 to 3 (+1 pp).** `set_pattern` tiles a short motif and accepts variations, which fixed seven compose cases (no repeating motif, no ties). It cost six: `compose-07`, `-09` and `-17` missed the requested pitch span or length, and `patch-insert-fx-02`, `-14` and `-16` no longer put the requested effects in order before the output. Net 9 improved, 6 regressed, 172 unchanged.

**Version 3 to 4 (+2 pp).** Each skill is offered only its own tools, tool schemas are slimmed (25-58% smaller per skill), the docs tools return ready-made `cite_as` links, `set_pattern` requires a length so a motif is always tiled, and `build_panel` completes an envelope section with all four stages. Two checks were also relaxed (`fx_before_output` accepts the effects anywhere on a signal path into the output, `docs-24` accepts the publishing page), so the effect-insertion and `docs-24` cases are not strictly comparable with versions 1 to 3. Net 13 improved, 10 regressed, 164 unchanged: the citation, compose and effect-insertion cases came back, while three unanswerable docs questions and three panel cases failed.

**Version 4 to 5 (+1 pp).** New modules are placed by code (`layout.py`) from their cables: flow runs left to right on the preset grid, voices are stacked as rows, nothing is placed on top of another module, and a prompt section gives layout guidelines. A new check, `layout` (no overlaps, at least 90% of the cables touching new modules run left to right), applies to 20 design and 34 patch cases; only run 5 was scored with it, and design and patch both stayed at 100%. Net 9 improved, 8 regressed, 170 unchanged.

### How much of the movement is noise

Between versions 4 and 5, 17 cases changed outcome while the total moved by one. Several of the flips cannot be caused by a layout change: `compose-01`, `-07` and `-21` flipped to a pattern-length or pitch-span failure, and `docs-17` and `docs-22` lost a fact in their text. With one repeat, a case near its pass boundary flips from run to run, so differences of a few points between versions, and the per-skill figures (n of 20 to 45), should be read as likely noise until a change is confirmed with `--repeats 3` or more. The effects that repeat across versions are the real ones: the panel and muted-module fixes, and the docs `says_unknown` and citation fixes.

### Failing in every run

Two cases fail in every version.

| Case | Why (latest run) |
|---|---|
| `docs-05` | The page about voice cells is not cited and the fact "CV to Notes" is missing |
| `docs-unanswerable-05` | Answers instead of admitting the documentation has no answer |

Whether a failure is the assistant's or the check's is decided from the case's log. Several early failures turned out to be the check (curly apostrophes, a waveform-specific jack name), and fixing a check is recorded in the notebook so the versions stay honest.

## Reading the compare report

`compare.md` has these sections, in this order:

| Section | Answers |
|---|---|
| Versions and what changed | The notebook entries, so the numbers sit next to their causes |
| Runs | Date, models, repeats, cost without cache, cost of that run, model time |
| Summary | The change from the baseline to the last version, per model |
| Overall | Success with its confidence interval, check score, tokens, provider cache hit rate, cost per request and per success, latency, calls, retried tool calls, errors |
| By skill, By difficulty | Where the change landed |
| Tokens and speed by skill | What each skill costs |
| Failed checks by kind | Which kind of check fails (for example `compose: pattern`) |
| Cases: A to B | Every case that improved or regressed between consecutive versions, with why it fails now |
| Case outcomes across all runs | One grid of the cases that differ |
| Failing in every run | The list above |

**Cost per success** (cost divided by the share of requests that succeeded) is the number to watch when comparing models: a cheap model that fails often is not cheap.

## Limits of these results

- **One model, one repeat.** Models answer differently each time; use `--repeats 3` or more before concluding that a small change helped, and read the confidence intervals.
- **Code-checked, not heard.** The checks prove that a patch is valid, audible and wired as asked, not that it sounds good. The graph model is an approximation by module role, not DSP. A real render of the patch is planned to replace it.
- **Generated cases are close to the presets they come from.** They test the assistant on known boards, not on the strange boards users build.
- **The benchmark was tuned against.** Fixes were made by reading failed cases of these 187, so the later versions are partly fitted to them. Add new cases when you fix a bug a user reports.
