# Patch assistant: implementation spec

Normative companion to [../agent-concept.md](../agent-concept.md) (goals, reasoning, evaluation design). This file
fixes the formats and interfaces the code is written against. Where the two differ, this file wins.

## 1. Pieces and where they live

| Piece | Path | Language |
|---|---|---|
| Library `bleep-agent` | `agent/` | Python 3.12, Pydantic AI |
| Backend integration | `website/api/app/routers/agent.py`, `agent_quota.py`, config, migration | Python (FastAPI) |
| Generated data (git-ignored) | `website/api/agent_data/` : `catalog.json`, `presets.jsonl`, `docs.sqlite` | built by `scripts/build/build-agent-data.sh` |
| Board chat panel | `patch/board/ui/agent-chat.js`, `agent-chat.css` (exposed as `P.BleepAgentChat`; the board seals its scripts, so it is not on `window`) | JavaScript |
| Evaluation workbench | `agent/evals/`, `agent/src/bleep_agent/evals/` | Python |

## 2. Data formats

### 2.1 Patch (the board document)

Exactly the board JSON the UI and engine use (`board::parse`):

```
{ "format": 1, "tempo": 120,
  "nodes":  [ { "id", "type", "name", "x", "y", "parent": "", "params": {paramId: 0..1}, "data"?: {...},
                "muted"?, "port"?, "track"? } ],
  "cables": [ { "id", "from": {"node","jack"}, "to": {"node","jack"}, "amount": -1..1 } ],
  "panels": [ { "id", "name", "cols", "rows", "controls": [...], "open"? } ] }
```

- `params` hold **normalised** values. The library converts to and from real units with the catalog.
- A cable's `to.jack` is an input jack id **or** a drivable param id (modulation, `amount` is the depth).
- `parent` is a cell id (`""` = top level). The first version edits only the top level and cells' contents by id;
  it never creates cells.
- Presets (`presets.jsonl`) are the same shape plus `name`, `module`, `description`, `tags`.

### 2.2 Catalog (`catalog.json`)

Built by `python -m bleep_agent.catalog build` from, in this order of authority:

1. `patch/board/ui/demo-types.json` (generated from the engine registry by `bleep_dump_types`; already carries
   `map`, `centre`, `show`, `names`, `normal`, `group`, `buttons`, choices, ranges, signal types);
2. `patch/modules/<slug>/module.json` (tagline, optional `agent` block: `roles`, `typical`, `pitfalls`);
3. `patch/modules/<slug>/doc/<slug>.md` (long text, referenced by doc chunk ids, not embedded in the catalog).

```
{ "version": 1, "source": {"types_sha256": "..."}, "signal_compat": [[from, to, ok, note], ...],
  "types": [ { "type", "name", "category", "description", "creatable", "port",
               "roles": ["source","filter",...], "doc": "module:filter", "typical": [...], "pitfalls": [...],
               "params": [ {id,name,kind,default,min,max,def,format,decimals,label,map,centre,choices,
                            modulatable,cableable,group,show,steps} ],
               "inputs":  [ {id,name,type,bipolar,normal?,show?} ],
               "outputs": [ ... ], "buttons": [...] } ] }
```

`roles` default from the category (table in `catalog.py`): `Sources/*` source, `Audio/Filters` filter, `Audio/Mixing`
vca|mixer, `Effects/*` effect, `Modulation/Envelopes` envelope, `Modulation/LFOs` lfo, `Sequencing/*` sequencer,
`Controllers/Performance` controller, `Ports` port, `Utility/*` utility; a `module.json` `agent.roles` overrides.
`python -m bleep_agent.catalog check` rebuilds in memory and fails if the file differs (run in CI/tests).

### 2.3 Sequencer data

`step-sequencer` node `data`: `{"steps": [{"g": 0|1, "p": semitones, "v": 1..127, ...}]}` plus node params for length,
rate, root, scale, octave, gatelength. Other sequencers have their own `data`; `set_node_data` accepts any object and the
library validates only the step-sequencer shape (length 1..64, `g` in {0,1}, integer `p`, `v` 1..127). Unknown shapes are
passed through when the type declares data (`sanitiseData`), i.e. when existing patches of that type carry `data`.

## 3. Operations (changesets)

### 3.1 Agent-facing ops (what tools accept; Pydantic discriminated union on `op`)

| op | fields | notes |
|---|---|---|
| `add_module` | `type`, `name?`, `ref?`, `params?` (real units or choice names), `near?` (node id), `parent?` | `ref` is a local handle usable by later ops in the same call |
| `remove_module` | `node` | destructive; removes its cables |
| `connect` | `from_node`, `from_jack`, `to_node`, `to_jack`, `amount?` | validated: jacks exist, types compatible, direction, no duplicate |
| `disconnect` | `cable?` or (`from_node`,`from_jack`,`to_node`,`to_jack`) | |
| `set_param` | `node`, `param`, `value` (real unit, choice name, or bool) | clamped and reported when clamped |
| `set_cable_amount` | `cable`, `amount` | |
| `insert_on_cable` | `cable` or (`from_node`,`from_jack`,`to_node`,`to_jack`), `type`, `name?`, `params?`, `in_jack?`, `out_jack?` | breaks the cable, inserts the module; stereo pairs (`l`/`r`) are handled together when both cables exist |
| `rename_module`, `move_module` | `node`, `name` / `x`,`y` | |
| `set_node_data` | `node`, `data` | e.g. sequencer steps |
| `set_muted` | `node`, `muted` (bool) | the module's Mute switch (`muted` on the node, not part of `data`) |
| `set_tempo` | `bpm` | |

`ref` handles are written as `"$name"` wherever a node id is expected.

### 3.2 Primitive ops (what the client applies; produced by the library, in order)

```
{"op":"add_node","node":{id,type,name,x,y,parent,params,data?}}
{"op":"remove_node","id"}
{"op":"add_cable","cable":{id,from,to,amount}}
{"op":"remove_cable","id"}
{"op":"set_param","node","param","value"}        // normalised 0..1
{"op":"set_cable_amount","id","amount"}
{"op":"set_data","node","data"}
{"op":"set_muted","node","muted"}
{"op":"rename_node","id","name"} {"op":"move_node","id","x","y"}
{"op":"set_tempo","bpm"}
{"op":"set_panel","panel":{...}}  {"op":"remove_panel","id"}
```

A **changeset** is `{id, summary, ops:[primitive...], lines:[diff text], destructive:bool}`. The client applies it as
**one undo step**. The library applies the same ops to its working copy first, so a changeset that does not validate
is never emitted; the model gets the error text instead and may retry. IDs generated by the library follow the board's
style (type slug, 6 characters, suffix to avoid clashes) and never collide with ids in the snapshot.

### 3.3 Layout of added modules

The model gives no coordinates. After the ops of a changeset are applied, `layout.py` places the modules it added from the cables, on the grid the presets use
(columns 300 apart, rows 220 apart, a module 184 wide, the board starts at 40, 40):

- the flow runs left to right: a module sits in the column after the right-most module that feeds it; a module that only feeds existing ones goes in the column before them;
- shared sources (keyboard, sequencer) come first at the left; each voice (the new modules connected without going through a mixer) is a block of rows, the main chain in
  one row and helpers such as an envelope in the row under it; further voices are stacked under each other in the same columns;
- a mixer sits right of the voices it mixes, at the height of their rows, and what follows it (effects) in line after it;
- a module is never put on a cell another module occupies (the next free row up or down is used);
- when a new module would sit right of (or above) a module it feeds, that module and everything right of it, except what feeds the new modules, is pushed to the right by
  `move_node` primitives in the same changeset;
- modules the model moved itself (`move_module`) stay; modules added without any cable keep their spot and are only cleared of others.

The add_node primitives carry the final positions. On the benchmark logs this took the share of cables that run backward or straight up from 36 % to 0 %.

## 4. Tools

All tools are Pydantic AI tools on one agent; the active **skill** decides which are visible.

Read (run on the working copy / catalog / indexes, no round trip): `list_module_types(query?, role?, category?)`, `describe_module(type, include_docs?)`, `search_presets(query, limit)`,
`get_preset(id)`, `get_panel(id?)`, `get_sequencer(node)`, `trace_signal(from_node?, to_node?)` (paths in the graph),
`check_audibility()` (static + simulated diagnosis, §6), `search_docs(query, audience?)`, `read_doc(id)`.
There is no `get_patch` or `get_selection`: the board (with the selection marked) is in the instructions of every step, always current. Each skill is offered only
the tools it uses (every definition is sent on every model call): the docs tools belong to `docs`, `list_module_types` to `patch` and `design`, `trace_signal`
to `patch` and `diagnose`.

Write (return a changeset or an error text): `propose_changes(ops, summary)`, `set_pattern(node, steps, params?)`,
`propose_panel(panel, summary)`, `layout_panel(...)` (helper that returns a tidy layout for the nodes' main params).

Live (**external**: the run ends, the client executes, a later request resumes): `get_environment`, `probe_signals`,
`play`, `highlight`, `ask_user`. Argument and result schemas: §5.4.

## 5. Protocol (HTTP)

### 5.1 Endpoints (mounted only when `BLEEP_AGENT_ENABLED=true`)

- `GET /api/agent/status` → `{"enabled": bool, "signed_in": bool, "budget_exhausted": bool, "reset_at": iso8601|null,
  "docs": bool}`. Always answers (also when disabled: `{"enabled": false}`), never 404, never calls a model.
- `POST /api/agent/chat` → `text/event-stream`. Requires a login (401 otherwise): the website's session cookie, or the app's personal token (`Authorization: Bearer blu_…`, the same one that shares presets); 429 with `Retry-After`
  and a JSON body `{"detail", "code": "budget", "reset_at"}` when the daily budget is used up (a plain `detail` for the per-user rate); 503 when not configured.

### 5.2 Request

```
{ "messages": [ {"role":"user"|"assistant","content": "text"} ],     // plain transcript, last is the user turn
  "snapshot": { "patch": {board json}, "selection": ["nodeId"], "environment"?: {...} },
  "mode": "ask" | "auto",
  "skill"?: "docs"|"diagnose"|"patch"|"panel"|"compose"|"design",    // optional hint; otherwise routed
  "resume"?: { "token": "...", "results": [ {"call_id": "...", "result": {...}} ] },
  "client": {"version": "..."} }
```

Limits: ≤ 40 messages, ≤ 200 kB total, patch ≤ 150 kB. When `resume` is present, `messages` is ignored (the token
carries the run's state) and `snapshot` must still be sent (it is the truth after anything the client applied).

### 5.3 Events (SSE; `event:` name, `data:` JSON)

| event | data |
|---|---|
| `run` | `{"run_id"}` first event of a request when the run log is on; the browser keeps the ids to fetch the log (Copy chat) |
| `text` | `{"delta": "..."}` |
| `activity` | `{"text": "Checking signal levels"}` |
| `changeset` | `{"id","summary","ops":[...],"lines":[...],"destructive":bool,"needs_confirmation":bool}` |
| `live` | `{"call_id","tool","args"}` (one or more; followed by `pause`) |
| `pause` | `{"token":"..."}` the run waits for `resume` |
| `usage` | `{"input_tokens","output_tokens","run_total","day_total","day_limit"}` |
| `error` | `{"code","message"}` codes: `budget`, `rate`, `model`, `invalid`, `internal` |
| `done` | `{"reason":"final"|"pause"|"budget"|"error"|"limit"}` |

`needs_confirmation` is true for destructive changesets in both modes and for every changeset in `ask` mode. In
`auto` mode the client applies non-destructive changesets at once. The token is an HMAC-signed, compressed
serialisation of the run's message history plus the working copy; it is valid for 15 minutes.

### 5.4 Live tools

| tool | args | result |
|---|---|---|
| `get_environment` | `{}` | `{"audio":{"running","sampleRate","muted"},"midi":{"inputs":[{"id","name","enabled"}]},"transport":{"playing","bpm"},"keyboard":[nodeIds]}` |
| `probe_signals` | `{"points":[{"node","jack"}], "seconds":≤2, "test_note":{"note","velocity","seconds"}?}` | `{"points":[{"node","jack","present":bool,"min","max","last","moves":bool,"transitions":int,"series":[≤40 numbers]}], "notes_sent":bool}` |
| `play` | `{"notes":[{"note","velocity","at","length"}], "seconds"}` | `{"played":true}` |
| `highlight` | `{"refs":[{"node","jack"?,"cable"?}], "message"?}` | `{"ok":true}` |
| `ask_user` | `{"question","choices":[str],"allow_text":bool}` | `{"answer":"..."}` |

`probe_signals` Phase 1 is computed by the client from the engine `state` messages (≈30 per second): `moves` from
`activity`, `series` from last-sample values, `transitions` from threshold crossings at 0.5.

## 6. Static diagnosis and simulator

`check_audibility()` returns structured findings, each with `code`, `severity`, `node?`, `jack?`, `message`, `fix?`
(a ready `propose_changes` argument). Checks: no audio-out node; audio-out unconnected; no path from any source to the
output; source without trigger path (VCA gain driven by an envelope whose gate has no cable); VCA/mixer gain at 0;
filter cutoff closed (param at minimum with no modulation); muted node; mixer channel/master at 0; MIDI source missing
for a patch whose notes inputs are driven by nothing; wrong signal type on a cable; disconnected required jack
(per catalog `required` roles). The same graph model with a stimulus (a held note on Keyboard/MIDI In, transport playing)
gives `simulate(patch, stimulus)` → per output `{present, moves}`, used by the evaluation's Phase 1 runner and as the
`probe_signals` implementation of the simulated client. It is an approximation (roles, not DSP); Phase 2 replaces it
with `bleep_render`.

## 7. Documentation index

`python -m bleep_agent.docs build --out docs.sqlite [--embed]` reads `website/content/**` and
`patch/modules/*/doc/*.md`, splits by heading (§ concept 5a), writes:

```
meta(key, value)                     -- docs_version, chunking_version, embed_model, dim, built_at, n_chunks
chunks(id TEXT PK, doc TEXT, title, path, audience, url, text, tokens INT, embedding BLOB NULL)
chunks_fts USING fts5(title, path, text, content='chunks')
```

`id` = `<doc>#<anchor>`; `doc` = `musicians/...`, `developers/...`, `module:<slug>`. Embeddings: float32, L2-normalised,
dimension from the model; `embed_model` in `meta` must equal `BLEEP_AGENT_EMBED_MODEL` or hybrid search is disabled
(keyword-only, logged). Queries: embed (task type retrieval-query), cosine over an in-memory matrix, FTS5 `bm25`, merge by
reciprocal rank fusion (k=60), boost by audience, return 6. Chunk embeddings go through the embedding cache (§9).

## 8. Backend

Settings (`BLEEP_` prefix): `agent_enabled=False`, `agent_daily_tokens=1_000_000`, `agent_model="google:gemini-3.8-flash"`,
`agent_embed_model="gemini-embedding-2"`, `agent_data_dir="agent_data"`, `agent_user_per_minute=6`,
`agent_max_steps=12`, the provider keys `GOOGLE_API_KEY` / `OPENAI_API_KEY` (the providers' own variables, read from the environment), `agent_state_secret` (HMAC key; random per process when empty).

Run log: table `agent_log(id, run_id, user_id, created_at, kind, data JSON)`, one row per record, kept to the newest
`BLEEP_AGENT_LOG_MESSAGES` rows (default 5000, 0 = off). Kinds per run, in order: `run_start` (prompt, history, the board snapshot, skill, mode),
`model_call` (the full messages sent including the instructions, the response with any thinking and tool calls, usage, latency, tools offered),
`tool_call` (arguments, result or retry error, duration), `event` (changeset, live, pause, usage, error, done), `answer`, and a final `summary`
(prompt, tools, tokens, calls, outcome). Written when the run ends, also when the browser left. Admin read API:
`GET /api/admin/agent-log/runs` and `/runs/{run_id}`. The log holds users' prompts and patches: say so in the privacy notice.

Table `agent_usage(day DATE PK, tokens BIGINT NOT NULL DEFAULT 0, requests INT NOT NULL DEFAULT 0)`; migration with
alembic. Budget: refuse a run when `tokens >= limit` (429, `reset_at` next UTC midnight); after every model call add
that call's tokens with `UPDATE ... SET tokens = tokens + :n` (insert-if-missing first). The router never imports the
library when disabled.

## 9. Evaluation workbench (summary; details in the concept note)

`python -m bleep_agent.evals run --providers gemini-3.8-flash,gpt-6-luna --skills docs,diagnose --repeats 3 --cache use`
→ `evals/runs/<ts>/{results.jsonl,report.md,report.json}`. Cache dir `.eval-cache/` (SQLite, content-addressed): kinds
`model`, `embedding`, `judge`, `render`; modes `use|refresh|replay-only|off`. Cases in `agent/evals/cases/<skill>/*.yaml`;
generators for fault-injected diagnose cases and patch templates in `agent/evals/generate.py`. Price table
`agent/evals/prices.yaml` (versioned; values are placeholders until set from the provider price lists).

## 10. As built: notes

- `messages` may be omitted or sent on `resume`; it is ignored then. `snapshot.environment` is optional; the live tool `get_environment` is the
  normal source.
- The client prefixes notes about applied, rejected or undone changesets to the next user message (`[...]`), so roles stay alternating.
- `probe_signals.present` is true for activity, movement or any non-zero value (a held gate counts as present).
- `ask_user` waits for a person (up to 10 minutes); other live tools are time-boxed to 5 s in the browser.
- Changeset ids are a hash of the operations, so a replayed conversation (evaluation cache) is identical.
- Skill routing is by keywords (`skills.route`), with the request's `skill` hint winning; questions go to `docs`.
- Docker: the API image installs the library from the named build context `agentlib` (`../agent`); `website/api/agent_data/` must exist
  in the build context (`scripts/build/build-agent-data.sh`); `constraints.txt` pins the library's dependencies (websockets moved to 16.x,
  which `google-genai` requires).
- **Copy chat:** the panel's "Copy chat" button builds one JSON document (`format: bleep-assistant-chat`): the transcript with timestamps and what became of
  each changeset, and, for every run id seen, the server's log from `GET /api/agent/log?run_ids=a,b` (a user reads only their own runs; runs the rolling
  log has dropped are listed as missing). A model call lists only the messages that are new since the previous call of its run
  (`request_first_messages_same_as_previous_call`), to keep the document small. It is copied to the clipboard, or saved as a file if the clipboard is refused.
