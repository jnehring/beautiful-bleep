---
title: Benchmark and results
description: The assistant benchmark (187 cases, six skills, simulated browser, deterministic checks), how to run and compare it, and the results of the versions so far.
order: 70
---

# Benchmark and results

Prompts and tools change how the assistant behaves in ways that are hard to predict, so every change is measured. The **benchmark** runs a fixed set of requests against the real agent loop and scores each result by code. The numbers on this page come from the report that `bleep-agent eval compare` writes to `agent/evals/runs/compare.md`. That file is generated and git-ignored; the results below are a snapshot of it from **2026-10-18** and are not updated by a build.

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

A run is a **success** only if every check passes and there was no error. The checks are code, not opinion: `audible`, `fixes_fault`, `unrelated_changes`, `cable`, `has_path`, `fx_before_output`, `param_range`, `module_added`, `valid_patch`, `no_state_change` (a question must not change the patch), `text_contains`, `cites`, `says_unknown`, `tool_used`, `panel_valid`, `panel_covers`, `pattern`.

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

All runs so far used one model, **gpt-6-luna**, one repeat, no judge, on the same 187 cases.

| # | Version | Success | Δ | Check score | Cost / request | Tokens in / out per request | Model calls / request | Latency p50 / p95 |
|---|---|---|---|---|---|---|---|---|
| 1 | First implementation | 74% (68%-80%) | | 0.91 | $0.0026 | 21,513 / 827 | 3.7 | 11.5s / 46.1s |
| 2 | Quick Wins | 90% (85%-93%) | +16 pp | 0.96 | $0.0025 | 21,007 / 760 | 3.6 | 11.8s / 35.4s |
| 3 | Motif tiling & lean lookups | 91% (87%-95%) | +17 pp | 0.97 | $0.0016 | 21,232 / 811 | 3.4 | 11.8s / 39.8s |

The ranges are 95% confidence intervals (Wilson). With 187 runs they are about ±4 points, so the jump from version 1 to 2 is real and the step from 2 to 3 (+1 point) is within noise. Cost per request fell by a third at version 3 because of provider prompt caching (50% of input tokens were cache hits); versions 1 and 2 predate that accounting and counted every input token at full price, so their costs are not comparable. The whole benchmark costs about **$0.30 without cache** and ran in about 49 minutes of model time.

### By skill

Success rate, 187 runs per version.

| Skill | Cases | 1 | 2 | 3 | Δ 1 to 3 |
|---|---|---|---|---|---|
| compose | 25 | 68% | 68% | 84% | +16 pp |
| design | 20 | 80% | 100% | 100% | +20 pp |
| diagnose | 45 | 84% | 96% | 98% | +13 pp |
| docs | 32 | 62% | 78% | 81% | +19 pp |
| panel | 25 | 56% | 92% | 92% | +36 pp |
| patch | 40 | 85% | 100% | 92% | +8 pp |

### By difficulty

| Difficulty | Cases | 1 | 2 | 3 | Δ 1 to 3 |
|---|---|---|---|---|---|
| easy | 58 | 93% | 95% | 93% | +0 pp |
| medium | 99 | 68% | 91% | 90% | +22 pp |
| hard | 30 | 60% | 77% | 93% | +33 pp |

The gains are in the medium and hard cases; the easy ones were already solved.

### Tokens and speed

Input tokens are about 21,000 per request in every version and have hardly moved. They add up over the 3 to 4 model calls of a request, and each call repeats the instructions (prompt, module index, the board). That is why prompt caching, not shorter prompts, gave the cost reduction. Design is the heaviest skill (about 45,000 tokens in, 5 calls, 28 s at p50) and docs the lightest (17,000 in, 3.4 calls, 8 s).

### What each version fixed

**Version 1 to 2 (+16 pp).** Most of the gain came from fixing the assistant and the benchmark where they disagreed with reality, not from a better model:

- an `unmute` operation, so five muted-module diagnose cases pass (`set_node_data` refuses `muted`),
- embedded sample audio left out of the board snapshot (boards with a sample were refused as too large),
- the board in the instructions and no `get_patch` calls,
- panels are rearranged and never trimmed (11 `panel_covers` failures became 2),
- "Minor", "Aeolian" and "Ionian" understood as the scale they mean,
- unanswerable docs questions now say so (`says_unknown`: 8 failures became 2).

**Version 2 to 3 (+1 pp, but a different profile).** `set_pattern` tiles a short motif and accepts variations, which fixed seven compose cases (no repeating motif, no ties). It cost six: `compose-07`, `-09` and `-17` now miss the requested pitch span or length, and `patch-insert-fx-02`, `-14` and `-16` no longer put the requested effects in order before the output. Net: 9 cases improved, 6 regressed, 172 unchanged. A change that is a net gain of 1 point can hide a lot of movement, which is why the report lists every case that flipped.

**Version 4, Lean tools & citations**, is recorded in the notebook (each skill offered only its own tools, slimmer tool schemas, ready-made citation links in the docs tools, a stricter-but-fairer set of checks) but its benchmark folder has no results yet, so it is not in the comparison. Its changed checks mean cases such as `docs-24` and `patch-insert-fx-*` are not strictly comparable with versions 1 to 3.

### Failing in every run

Nine cases fail in every version; they are the next things to look at.

| Case | Why (latest run) |
|---|---|
| `compose-01` | 15 gated steps, where 9 to 14 are asked for |
| `diagnose-source-unwired-05` | The answer names none of the expected terms |
| `docs-05`, `docs-17`, `docs-24` | Missing fact or missing citation of the page that holds the answer |
| `docs-unanswerable-02`, `-05` | Answers confidently instead of admitting the documentation has no answer |
| `panel-build-06`, `-07` | A wired knob (`adsr.release`, the ring `level` knobs) is left off the panel |

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
