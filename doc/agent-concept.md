# Patch assistant: concept note

Status: first version implemented (library `agent/`, backend integration, board chat panel, evaluation workbench); see
[specs/agent.md](specs/agent.md) for the formats as built. Model names are taken from the plan and not verified.

## 1. Goal

A chat window in the board in which an AI agent helps build patches: it explains, diagnoses, edits the patch,
programs sequencers, designs sounds and builds panels. The user stays in control: every change to the patch is
a visible, undoable changeset.

Non-goals for the first version: autonomous long-running composition, audio generation by the model itself,
multi-user sessions, training or fine-tuning.

## 2. Use cases

| Area | Example queries | Priority |
|---|---|---|
| Debugging and help | "why do I not hear sound?", "how do I wire the adsr to the vca?" | 1 |
| Documentation | "what does Drive do in the Multi Filter?", "how do I sign a module?", "how do I load a patch from the library?" | 2 |
| Patching | "add chorus and reverb between the synth and the output", "add my usb midi keyboard to the patch" | 3 |
| Panels | "build a panel for the patch", "organize the panel" | 4 |
| Composition | "in the step sequencer program an acid line" | 5 |
| Sound design | "build an acid synthesizer" | 6 |

Three modes of work with different needs:

| Mode | Needs | Risk |
|---|---|---|
| Explain (read-only) | patch, module catalog, documentation, live signal state | low: a wrong answer wastes time |
| Edit (small, precise changes) | typed edit operations, validation, undo | medium: can break a working patch |
| Create (open-ended, iterative) | reference presets, sequencer and panel models, a way to judge the result | high effort: "good" is subjective |

Notes per use case:

- **Why no sound** needs measurement, not guessing: a patch is often silent because nothing is playing, not because
  it is broken. See section 7 (probe).
- **Documentation questions** are answered from the musicians' and developers' documentation, with links to the
  pages used. They are answered with a RAG step (hybrid keyword and embedding retrieval); see section 5a. They are cheap, read-only
  and need no engine work, so they are an early win.
- **Wiring help** should end in a one-click "apply this" changeset and a highlight of the ports on the board.
- **Insert on cable** is the core edit: find the cable, break it, insert modules, set sensible defaults.
- **USB MIDI keyboard** needs device enumeration and the user's choice; the agent cannot conjure a device.
- **Acid line / acid synth** are iterative: generate, play, the user reacts, revise. The agent cannot hear.
- **Panels** are well suited: the format is JSON, grouping by function is where an LLM saves effort, and the
  result is checkable.

## 3. Architecture

```
Browser (board UI)
  chat panel, patch snapshot, executes live tools (probe, play, highlight, ask_user), applies changesets
        |  HTTPS + SSE (stateless: message history + snapshot in every request)
        v
website/api  (FastAPI)       auth, rate limit, streaming; thin router
        |
        v
agent/  (Python library "bleep-agent", same repo, no FastAPI dependency)
  catalog, patch model, changesets, tools, skills, agent loop (Pydantic AI)
        |
        v
LLM provider (Gemini first; OpenAI gpt-6-luna for comparison)
```

Decisions taken:

- **Agent framework: Pydantic AI.** Same Pydantic v2 as the existing backend, typed tools, validation with retries,
  streaming, deferred/external tools, a test model. No LiteLLM: Pydantic AI supports the providers we need directly
  and has a fallback wrapper. LiteLLM can be added behind it later for central keys and budgets without changing
  agent code.
- **Stateless backend.** The client sends the message history and a snapshot (patch, selection, panel, sequencer
  state) with every request. No session storage; larger requests are acceptable.
- **The library runs on the backend**, as its own Python package in this repo. It takes a model name or model object
  from its caller and never imports a provider directly.
- **One agent with skills**, not several agents (section 5).

### Library layout

```
agent/
  pyproject.toml                 name: bleep-agent
  src/bleep_agent/
    catalog.py                   loads bleep-catalog.json
    patch.py                     Patch model (board JSON), graph queries
    changeset.py                 typed ops, validation, apply
    panels.py, sequencer.py
    tools/                       read.py, write.py, live.py (external tools)
    skills/                      diagnose, patch, panel, compose, design
    agent.py                     builds the Pydantic AI agent
    protocol.py                  request/response/event schemas
  tests/                         unit tests with the test model, golden patches
  evals/                         workbench (section 9)
website/api/app/routers/agent.py thin: auth, rate limit, SSE, calls bleep_agent
```

The library also runs from a CLI, for evals and development without the web stack.

## 4. Catalog and patch model

### Catalog

The source of truth for module types is C++: each module registers a `ModuleSpec` (`patch/engine/Spec.h`) with
params (id, name, kind, range, mapping, unit, choices, groups, visibility conditions) and input/output jacks with a
signal type (`Control, Gate, Trigger, Pitch, Audio, Notes, Patchbay`). `bleep_dump_types` already exports this as
`patch/board/ui/demo-types.json` (130 types) and ctest checks that the copy is current. Prose docs sit next to each
module in `patch/modules/<slug>/doc/<slug>.md`.

The agent catalog extends this export, in three layers:

1. **Structure (generated, exact):** types, params in real units with mapping (linear/exponential/skew), jacks with
   signal types, `when` visibility, `normalledTo`. Generated from the registry by extending `bleep_dump_types`, with
   a `--check` in ctest so it cannot drift. Today `demo-types.json` mixes UI fields with real ones (`default` is
   normalised, `def` is real); the catalog uses real units only.
2. **Semantics (small, hand-written, optional per module):** an `agent` block in `module.json`: `roles` (vca,
   filter, reverb, envelope, ...), typical connections, pitfalls. This lets "chorus and reverb" resolve to module
   types without guessing.
3. **Docs (generated):** the module markdown, chunked per module and fetched on demand by `describe_module`, never
   put into the prompt as a whole.

Also needed: cable compatibility rules between signal types, derived from the engine, so `connect` can be validated
and explained.

### Patch model

The patch format is the existing `board::parse` JSON (`nodes` with `type` and params, `cables`). The Python `Patch`
model uses exactly that format, so snapshots, changesets, evaluation fixtures and offline-render inputs are the same
data. The library keeps a working copy per request; write tools apply to it so the model sees the effect of its own
edits within a run.

## 5. Agent, skills, tools

### One agent with skills

Almost every use case works on one patch and builds on the previous turn, so one conversation with shared context
fits. A skill is a prompt section plus a tool subset, loaded when the task needs it:

| Skill | Handles | Tools |
|---|---|---|
| Docs | questions about using or extending Bleep | search_docs, read_doc, describe_module |
| Diagnose | no sound, wiring help | read tools, probe, highlight |
| Patch | insert on cable, add MIDI device | read tools, propose_changes |
| Panel | build / organize panels | get_panel, propose_panel |
| Compose | acid line | get_sequencer, set_pattern, play |
| Design | acid synth | all of the above plus presets |

Sub-agents are added later only where measured to help: a critic that probes and measures a finished patch with a
fresh view, and a preset scout that returns three short candidates instead of dumping presets into the chat.
Pydantic AI lets an agent call another agent as a tool, so this needs no restructuring.

### Tools

**Read (run in Python against the snapshot, no approval):** `get_patch`, `get_selection` (resolves "this" and "the
synth"), `list_module_types`, `describe_module`, `search_presets`, `get_preset`, `get_panel`, `get_sequencer`, `search_docs`, `read_doc`.

**Write (produce a changeset):** `propose_changes(ops[], summary)` with typed ops `add_module`, `remove_module`,
`connect`, `disconnect`, `set_param`, `insert_on_cable`, `move`, `set_midi_input`; `set_pattern`; `propose_panel`;
`undo`. Ops are Pydantic models, validated against the catalog in Python: a bad port name fails immediately with a
message the model can retry on. The model never writes raw patch JSON.

**Live (external; the run pauses, the browser executes, the run resumes):** `get_environment` (audio device state,
MIDI devices), `probe_signals`, `play`, `measure_audio`, `highlight`, `ask_user`.

### Ask and auto modes

Every write is a changeset. In **ask** mode the user sees a diff ("+ Chorus, + Reverb, 2 cables rewired") with
Apply / Reject. In **auto** mode the client applies it as it streams in, as one undo step, and the chat shows
"Applied: ... (Undo)". Destructive operations (`remove_module`, replacing a whole panel) ask even in auto mode
unless the user turns that off. The client's undo stack is the safety net in both modes.

## 5a. Documentation questions: a RAG step

The documentation is about 45,000 words in `website/content` (musicians and developers) plus about 140,000 words in
the per-module docs `patch/modules/*/doc/*.md`: roughly 250,000 tokens in all. That is too much to put into every
prompt (cost, latency, and the daily token quota in section 8), so a Docs question runs a retrieval-augmented
generation (RAG) step: relevant chunks are found first and handed to the model, which answers from them.

Two things pull in different directions. The text is full of exact terms (module, port and parameter names, file
names), where keyword search is strong. Musicians ask in everyday words ("why does my sound crunch?" for a page
about aliasing and Drive), where embeddings are strong. So retrieval is **hybrid**.

### Index (build time, next to the existing docs generation)

- **Chunking:** split every page by heading into chunks of roughly 200-500 tokens. Each chunk keeps its heading
  path ("Modules > Multi Filter > Drive") prepended to its text, because the path carries most of the meaning for a
  short section. Metadata: id, title, heading path, audience (musicians / developers / module), docs version, URL
  with anchor. Very long sections are split at paragraph boundaries; very short ones merge into their parent.
- **Keyword index:** SQLite FTS5 over the chunk text and the heading path (module names weighted up).
- **Vector index:** one embedding per chunk from the embedding model set in the configuration (`gemini-embedding-2`; the name is
  taken as given, not verified here), stored as a BLOB column in the same SQLite file. About 2,000 chunks
  of float32 vectors take 2,000 x dimensions x 4 bytes (about 6 MB at 768 dimensions, 25 MB at 3,072), so the API
  loads all vectors from the file into one in-memory array at start and does a brute-force cosine search
  (milliseconds). The file stays on disk and is the source; only the vectors (and the chunk metadata needed to
  build a prompt) live in memory, while the FTS5 keyword index is read from the file by SQLite. Each API worker holds
  its own copy; the API runs one worker today. No vector database and no SQLite extension needed; a vector extension remains an
  option if the corpus grows by an order of magnitude.
- **Incremental build:** each chunk embedding goes through the embedding cache (section 9), keyed by the embedding
  model and a hash of the chunk text including its heading path. Rebuilding the index after a docs edit therefore
  embeds only the changed chunks; a rebuild without changes makes no API calls.
- **One file, versioned:** the index file records the docs version, the chunking version and the embedding model.
  If the configured embedding model differs from the one in the file, the Docs skill refuses to start with a clear
  log message, because query and chunk vectors from different models are not comparable.
- The file ships in the API image. A table of contents of about 3,000 tokens (the pattern of the existing
  `llms.txt`) goes into the Docs skill's prompt so the agent knows what exists.

### Query time

1. **Condense:** if the conversation has earlier turns, the question is rewritten into a standalone query ("and
   what about resonance?" becomes "Multi Filter resonance"). This is one short model call (or part of the
   agent's first step); skipped for a first question.
2. **Retrieve:** the standalone query goes to both indexes; the top 20 of each are merged by reciprocal rank
   fusion; audience hints (musician or developer wording, or the user's current page) boost matching chunks; the
   top 6 survive, neighbours of a hit in the same page are added if the hit is cut off mid-explanation.
3. **Augment:** the surviving chunks (about 2,000-4,000 tokens) are placed in the prompt as quoted source material,
   each with its id and URL. They are data, not instructions.
4. **Generate:** the agent answers from the sources, cites the pages (links), says plainly when they do not cover
   the question, and matches the audience: plain musical language for musicians, technical for developers.
5. **Follow up if needed:** the agent keeps `search_docs(query, audience?)` and `read_doc(id)` as tools for a
   second search with different wording or to read a whole page. The RAG step is the default first move, the tools
   are the fallback; a question that clearly needs no documentation is not retrieved for (greetings, patch edits).
   The module docs are also reachable through `describe_module`.

### Cost

The embedding call for a query is a few dozen tokens and counts against the daily budget like any other call. The
retrieved chunks add about 2,000-4,000 tokens per documentation question, so a question costs roughly 8,000-20,000
tokens in total (section 8). Chunk embeddings are computed once at build time and cost nothing at run time.

### Evaluating retrieval on its own

The Docs cases (section 9) record which page(s) hold the answer. That allows measuring retrieval separately from
generation: recall@6 and mean reciprocal rank for keyword only, vectors only and hybrid, per audience and per
question style (exact terms against everyday wording). If hybrid does not beat keyword-only on the everyday-wording
questions, the embedding step is not worth its dependency and the plain FTS version remains. The embedding model and
the chunking are configuration, so variants run through the same workbench and cache.

## 6. Protocol

One request per user turn, over HTTPS with a server-sent event stream back:

- Request: message history, snapshot, mode (ask/auto), model/skill hints, results of live tools from the previous
  pause.
- Events: text deltas, tool activity ("checking signal levels..."), changesets, live-tool requests (the run ends
  there; the client executes and sends the result with the next request), final answer.

Because the backend is stateless, a paused run is just a request/response pair; nothing is held open.

## 7. Engine support: probe and offline render

### Probe (`probe_signals`)

A probe is a measurement over a time window, not a snapshot: an idle synth and a broken synth look the same at one
instant.

1. **Static checks first, no audio:** device open or muted, master volume, output connected, module bypassed or
   muted, MIDI source present, transport running. Read from the snapshot and `get_environment`.
2. **Timed run (about 1 s):** the agent picks probe points by walking the graph from the source to the speakers
   (up to about 30). The client optionally injects a test note (about 0.5 s), unless the user is playing; without
   a stimulus, silence tells nothing. The agent announces the test note first; in ask mode the user confirms.
3. **Result per point, compact:** audio: peak, RMS (dBFS), clipping; gate/trigger: rising edges, fraction high;
   CV: min, max, mean and optionally a coarse time series (about 20 bins) for envelope shape; notes: event count.

The agent walks the path backward from the speaker to the first point where the signal vanishes, answers with the
cause ("your ADSR never receives a gate") and highlights the cable.

Engine side. The browser does not run the C++ `Program`: `patch/web/js/graph.js` is a JavaScript port of it that runs
in the AudioWorklet, with one WASM instance per module. That makes the probe cheaper than first thought:

- `graph.js` already tracks per output an **activity** value (how far the output moved in each chunk, accumulated
  until read) and its `snapshot()` (the bridge `state` message) already returns the **last sample of every output**
  and the activity. The board draws the pulsing cables from this.
- **Phase 1, no engine change:** the client polls `state` for the window and derives, per output: moved or flat
  (activity), and a coarse time series of the last-sample values. That already shows whether an envelope moves, a
  gate toggles (counted as value transitions) or a path is dead. The worklet posts `state` every `sampleRate / 30`
  frames (`worklet.js`), so about 30 times a second: a 1 s probe yields about 30 samples per output. That is enough
  for the diagnosis cases: a held gate and a sustained envelope are visible, "this output never moves" is reliable
  (activity above 1e-4, accumulated between two snapshots, so a short trigger is not missed even when the sampled
  value is). It is not enough for exact levels: the activity is the largest range inside one 32-sample chunk, which
  underestimates slow signals (a 100 Hz tone moves about 40 % of its amplitude in a chunk), the sampled values are
  single samples, and a trigger of a few milliseconds cannot be counted. Phase 1 therefore reports "signal present /
  flat / moving" and coarse shapes, and the agent words its answers that way; dBFS, clipping and edge counts wait for
  Phase 2.
- **Phase 2:** an optional accumulator in `graph.js`'s per-chunk loop for the probed outputs only: peak, sum of
  squares (RMS), min, max, mean, gate edges. Plain JavaScript in the worklet, off unless a probe is running, so no
  cost otherwise. This gives true audio levels and clipping.
- Raw audio never leaves the browser; only the compact report goes back as the tool result. A probe has a fixed
  maximum duration and point count.
- The standalone desktop app's C++ engine is not part of the first version of the chat; the same accumulator can be
  added to `Program` later (it is the same structure).

### Offline render (`bleep_render`)

`patch/tests/demo_patches_test.cpp` already renders a board offline: `board::parse`, `Program::compile`, the
audio-out node swapped for a sink module that records peak, RMS and finiteness, 12 s in 256-sample blocks with the
transport playing, MIDI inputs dropped. It runs far faster than real time.

A small CLI built from this code: board JSON plus a stimulus (notes with start and length, transport, tempo, knob
changes) plus probe points in, JSON features out (peak, RMS, edges, CV stats; spectral centroid and similar at
the output).

**Test notes:** the Keyboard module has a `perform` action (`on note [velocity]`, `off note`, `allOff`) that queues
notes into its Notes output; the web board's on-screen keyboard already uses it (`bleep-web.js`), and
`Program::compile` returns the module map the test already holds, so the CLI calls `perform` on the Keyboard module
at the stimulus times. The Keyboard cannot simply stand in for a MIDI In node: the jack ids differ (`vel` against
`velocity`) and MIDI In also has `pressure`, `bend`, `mod` and `cc1`..`cc8`, which a Keyboard lacks, so cables from
them would be dropped. Instead, the render CLI registers a test-only module (the way `demo_patches_test.cpp`
registers `demo-sink`) whose spec copies MIDI In's jacks exactly. It reuses the Keyboard's notes-to-CV code for
`notes`, `pitch`, `gate`, `velocity` and `trigger`, accepts `perform` for notes, and holds the other outputs at 0
unless the stimulus sets them (a CC value or bend). It replaces each MIDI In (and MIDI Device) node under the same id,
so the graph is unchanged. A board without any MIDI source gets a Keyboard added and wired the way "Load as
instrument" does it. The live probe in the browser needs none of this: it calls `perform` on the board's Keyboard,
or on an added one, and MIDI In nodes are fed by the engine's own MIDI queue.

The measurement is the same idea in both places (per-output peak, RMS, edges, min/max/mean over a window), written
twice: JavaScript in `graph.js` for the browser, C++ in the render CLI. The evaluation therefore checks the same
quantities the live agent sees; a small test compares the two on a few patches so they cannot drift.

## 8. Access, switch, quotas, safety

### Switch and configuration

Configuration lives in `website/api/app/config.py` and `website/.env.example`, with the existing `BLEEP_` prefix:

| Variable | Default | Meaning |
|---|---|---|
| `BLEEP_AGENT_ENABLED` | `false` | Master switch. Off: the agent router is not mounted (404), no model is ever called, and `GET /api/agent/status` answers `{"enabled": false}`, which makes the board hide the chat panel. The library is not imported when off. |
| `BLEEP_AGENT_DAILY_TOKENS` | `1000000` | Daily token budget for **all users together** (input + output tokens as reported by the provider, UTC day). |
| `BLEEP_AGENT_MODEL` | (set per deployment) | Model string handed to the library, e.g. the Gemini flash model. |
| `BLEEP_AGENT_EMBED_MODEL` | `gemini-embedding-2` | Embedding model for the documentation index; must match the model recorded in the index file (section 5a). |
| `BLEEP_AGENT_DOCS_INDEX` | path in the image | The documentation index file. |
| `BLEEP_AGENT_API_KEY` etc. | none | Provider key, only in the backend environment. |
| `BLEEP_AGENT_USER_PER_MINUTE` | `6` | Optional per-user request rate, using the existing in-memory limiter (`app/ratelimit.py`). `0` turns it off. |

Per-user daily quotas are not part of the first version; the global budget is the control. A per-user cap can be
added later with the same table.

### Access

Only signed-in users (the existing session cookie) can chat. The status endpoint tells the board whether the feature
is on, whether the user is signed in, and whether the budget is used up (not the exact numbers). The board served
without the backend (static `/play/`, the desktop app) simply has no chat panel.

### Quota mechanism

- A table `agent_usage(day, tokens)` (one row per UTC day, alembic migration) holds the global count, so a restart
  does not reset it. Optionally also `(day, user_id, tokens)` for statistics and a later per-user cap.
- Before a run starts: if today's total is at or above the budget, the request is refused with HTTP 429, a clear
  message and the time of the reset. After every model call the tokens it used are added (a run can therefore end
  early with "daily budget reached" and the changes made so far stay valid). A run in progress may overshoot by one
  call; that is accepted.
- The counter is incremented atomically in the database (single `UPDATE ... SET tokens = tokens + n`), so it is safe
  if the API ever runs more than one worker.
- Evaluation runs use their own keys and count nothing against this budget.

### What the budget means

At 1,000,000 tokens a day, a documentation question (system prompt, retrieved chunks, one or two model calls) uses roughly
8,000 to 20,000 tokens, so about 50 to 120 per day; a patch-editing task with probes and retries uses roughly 50,000 to
150,000, so about 7 to 20 per day. These are estimates to be replaced by the evaluation's measured averages. At
flash-class prices the money is small; the budget is mainly a cap on abuse and surprises. Context-size discipline
(section 5a, tools that fetch on demand instead of dumping the catalog) matters because it is the quota's main lever.

### Safety

- All writes go through one validated mutation API; changesets are undoable.
- API keys stay server-side.
- Request size and run length are capped (steps per run, probe points, probe duration, tokens).
- Privacy: the messages, the patch snapshot and any documentation fetched are sent to the model provider. The chat
  panel says so before first use, and the site's privacy page is updated. Chat history is not stored on the server
  (section 11).
- The test note is audible; the agent says so before playing it.
- Content from patches, presets and docs is data for the model, never instructions to follow outside the tool
  surface; the tool surface itself is what bounds damage.

## 9. Evaluation workbench

Purpose: compare providers per skill on quality, cost and latency; track regressions from prompt or tool changes.
First run: `gemini-3.8-flash` and OpenAI `gpt-6-luna` as agent models; `gemini-4-argon` as judge. Model names are
configuration strings, taken as given and not verified here; each is stored with a price table in the run's
configuration.
The judge shares a provider with one candidate, so judge scores for that candidate are read with that bias in mind;
deterministic checks come first for this reason.

### Cases

One YAML file per case: id, skill, difficulty, tags, starting patch (fixture), query, deterministic checks, optional
judge rubric.

| Skill | Cases | How they are built | Main checks |
|---|---|---|---|
| Docs | 40 | Questions written from documentation chunks (20 musicians, 20 developers) by a strong model from the page text, reviewed by a person; some unanswerable (the docs do not say) and some in everyday words that differ from the docs' terms | retrieval on its own (gold pages recorded per question; recall@6 and MRR for keyword, vector and hybrid, split by question style: exact terms or everyday wording); cites the right page(s) (structured `sources` field); key facts from the page present; says "not documented" when it is not; judge for faithfulness (no claims beyond the sources) |
| Diagnose | 40 | Fault injection into working presets (cable removed, gate unconnected, VCA CV at 0, filter closed, master at 0, output muted, no MIDI source, wrong signal type); 8 faults x 5 presets, some with two faults, some healthy | final answer names the injected fault (structured `root_cause` field); applying the fix restores sound |
| Explain / wiring | 20 | Hand-written Q&A over catalog modules | correct port ids; changeset has the right cable |
| Patch | 40 | Templates x fixtures | graph predicates, minimal diff, invalid-op count, still renders sound |
| Panels | 25 | Patches without a panel, messy factory panels | schema valid, controls exist, key params covered, no overlap or out of bounds, grouping; judge on a rendered screenshot |
| Compose | 25 | Prompts with explicit musical constraints | see below |
| Design | 20 | Sound descriptions with reference presets | see below |

About 210 cases, 3 repeats each (the model is stochastic).

### Scoring, in order of trust

1. Deterministic checks (graph assertions, schema, render features): the headline number.
2. Behavioural checks: the fix is applied and re-probed.
3. LLM judge for what code cannot decide: fixed rubric, pinned judge, pairwise comparison preferred over absolute
   scores, calibrated by a small human spot-check.

### Hard categories

Composition and sound design are partly subjective and are scored in two parts, reported separately:

- **Hard part (code):** Compose: requested length and step count, notes in scale and a plausible range (acid
  usually spans 1-2 octaves), gate variation, accents and slides when asked, a repeating motif, valid sequencer
  format. Design: structure (saw/square oscillator, resonant low-pass filter, VCA, envelope on cutoff), parameters
  in range, renders sound, audio features (spectral centroid sweeps over the note, resonance peak) compared with a
  reference preset by feature distance.
- **Soft part (judge, humans):** pairwise judge over a symbolic piano-roll rendering (Compose) or feature summary
  (Design), reported as win rate with sample size and flagged low confidence; a human listens to 10 random results
  per provider per release. These are not headline scores on their own.

### Runner

A headless simulated client supplies the snapshot and implements the live tools. Phase 1: a signal-propagation model
of the graph (enough for Diagnose and Patch). Phase 2: `bleep_render` for real sound checks. Dataset and evaluator
scaffolding from Pydantic AI's evals package if it fits; to be checked.

### Metrics

Per provider and skill, with 95% confidence intervals over repeats: success rate (all hard checks pass) and a
partial score; invalid tool call rate, unnecessary changes, steps; cost per request (input, output and cached
tokens x a versioned price table); **cost per successful task**; latency p50/p95 and time to first token;
reliability (timeouts, provider errors, malformed responses). Output: a provider x skill table, a cost-vs-quality
scatter, per-case drill-down with full transcripts, and a run-vs-run comparison.

Rough size: 210 cases x 3 repeats x 2 providers is about 1,260 runs of 5-15 model calls each: a modest cost for
flash-class models; to be measured, not assumed.

### Cache

Re-running unchanged work is free and instant; only what changed re-runs.

| Cache | Key | Stores |
|---|---|---|
| Model call | provider, model, settings, system prompt, full messages, tool schemas, repeat index | raw response, token usage (including cached tokens), original latency |
| Embedding call | embedding model, task type, output dimensions, input text | the vector and token usage |
| Judge call | judge model, rubric version, judged inputs | verdict and reasoning |
| Render / probe | patch hash, engine version, stimulus | measured features |
| Check results (optional) | final patch hash, checks version | pass/fail per check |

The agent loop is deterministic when every model response and tool result is replayed, so whole trajectories replay
from cache; a changed prompt or tool output changes the keys from that point on, and only the affected calls
re-run. The repeat index is part of the key, so repeats stay separate samples. A hit returns the stored tokens and
latency, so reports keep valid cost and latency. Modes: `use` (read-through), `refresh`, `replay-only` (a miss
fails; for CI without API keys, with a small committed golden cache), `offline`. Implemented at the HTTP layer of
the provider client (request body minus auth and volatile fields), so it is provider-agnostic and needs no agent
code changes; stored in SQLite or files under a gitignored `.eval-cache/`, with a version field per entry.
Providers' own prompt caching is separate (it lowers production cost); the workbench records cached-token usage
and prices it.

## 10. Phasing

1. **Foundations:** catalog export and ctest check; Patch model and changesets in `agent/`; library test setup;
   the `.env` switch, status endpoint and token budget table.
2. **Documentation, explain and diagnose:** the docs index (build step: chunks, FTS5 and embeddings) with the RAG step and Docs skill; read tools,
   highlight, static checks, graph-model probe and the `state`-polling probe; chat panel in the board; the
   workbench with Phase 1 runner and cache; first Docs, Diagnose and Patch datasets.
3. **Edit:** ask/auto modes, undo, insert-on-cable, MIDI device flow.
4. **Real measurement:** accumulator in `graph.js` for true levels, `bleep_render`, Phase 2 runner.
5. **Panels**, then **Compose**, then **Design**, each with its dataset; sub-agents (critic, scout) only if
   evaluation shows a gain.

## 11. Decisions and open questions

Decided:

- **Per-output measurement:** the browser engine is `graph.js` (a JavaScript port of `Program`), which already tracks
  activity and last values per output; the probe starts from that and adds an accumulator later (section 7). No
  audio-thread work in C++ is needed for the browser.
- **Test notes:** the Keyboard module's `perform` action, in the browser and in `bleep_render` (section 7).
- **Reading the tap from the UI:** the bridge `state` message already carries it.
- **Access and budget:** signed-in users only; the whole feature is switched by `BLEEP_AGENT_ENABLED` (default
  off); the global daily budget is `BLEEP_AGENT_DAILY_TOKENS`, 1,000,000 for now (section 8).
- **Chat history:** only in the browser for now (local storage, per patch, with a clear button). Nothing is stored
  on the server; each request carries the history, so the provider sees it for that request. Moving it to the
  account later would be a new table and endpoints, not a change to the agent library.
- **Documentation questions:** a RAG step with hybrid retrieval (FTS5 keyword search plus embeddings in one SQLite
  file, merged by reciprocal rank fusion), with `search_docs` as fallback tool (section 5a). Retrieval is evaluated
  on its own, and the embedding part stays only if it beats keyword-only on everyday-wording questions.
- **Semantic metadata for modules:** the catalog already has a category ("Audio/Filters") and a description per
  module, which carries most of the role information. Hand-written `agent` blocks start with the 25 or so modules
  the starter patches and common requests use (oscillator, filter, envelope, VCA-like modules, LFO, delay, chorus,
  reverb, mixer, compressor, Keyboard, MIDI Device, sequencers); the rest are drafted by a model from the module
  docs and reviewed by a person. The evaluation shows whether the remaining gaps hurt.

- **OpenAI model:** `gpt-6-luna`.
- **Probe resolution:** the browser posts `state` about 30 times a second, enough for presence, movement and coarse
  shapes, not for exact levels or short triggers; the accumulator is Phase 2 (section 7).
- **MIDI In in the render CLI:** a test-only module with MIDI In's exact jacks replaces it under the same id (section
  7); the Keyboard itself cannot, because its jacks differ.

Still open:

- Whether the chat should also work in the standalone desktop app (it would call the hosted API); out of scope for
  the first version.
- Wording of the privacy notice for sending patches and messages to the model provider.
