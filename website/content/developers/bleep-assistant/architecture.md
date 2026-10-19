---
title: Assistant architecture
description: The pieces of the Bleep Assistant (board, website API, bleep-agent library, model provider, built data) and how they fit.
order: 20
---

# Assistant architecture

![The chat panel in the board posts the message history and a snapshot of the board to the website API. The API checks sign-in, rate and the daily token budget, calls the bleep-agent library, and streams events back. The library holds the agent loop, the skills and tools, the patch model and the documentation search. It calls an LLM provider and reads built data files.](/img/assistant-architecture.svg)

## The pieces

**The board (browser).** The chat panel (`agent-chat.js`) sends the conversation and a **snapshot** of the board with every request, shows the streamed answer, and applies changesets to the real board as one undo step. It also runs the *live tools*, the few things only the browser can do: measure signals, play notes, highlight a jack, ask the user a question.

**The website API.** A thin FastAPI router (`routers/agent.py`) mounted only when the assistant is enabled. It requires a signed-in user (the website's session cookie, or the library token of the standalone app and the Bleep Board plugin), applies a per-user rate limit and a **daily token budget** for the whole site, turns the library's events into a Server-Sent Events stream, and writes the run log. It holds no conversation state.

**The `bleep-agent` library.** Everything that makes it an assistant, with no web code: the agent loop, the skills and tools, the patch model, the catalog, the documentation search. It is given a model by its caller and never imports a provider itself, so the site, the command line and the benchmark can use different models.

**The model provider.** Gemini first, OpenAI for comparison. The library talks to it through Pydantic AI, wrapped in a metering layer that counts tokens after each call and refuses the call when the budget is gone.

**Built data.** Three git-ignored files in `website/api/agent_data/`, produced by `scripts/build/build-agent-data.sh`:

| File | Holds | Built from |
|---|---|---|
| `catalog.json` | Every module type: knobs with ranges and units, jacks with signal types, roles, typical wiring, pitfalls | The engine's module registry (`demo-types.json`), each module's `module.json`, the signal compatibility rules |
| `presets.jsonl` | Example patches the assistant can study | The factory presets |
| `docs.sqlite` | The documentation, chunked, with a keyword index and optional embeddings | `website/content/**` and the module manuals; see [Documentation search](documentation-search.md) |

## Design decisions

- **One agent with skills, not several agents.** Nearly every request works on one patch and builds on the previous turn, so a single conversation with shared context fits. A *skill* is a prompt plus a subset of tools; see [Skills and tools](skills-and-tools.md).
- **Stateless backend.** The client sends the history and a snapshot with every request, so the API needs no session storage and any worker can serve any request. The price is a larger request (limits: 40 messages, 200 kB, a board of at most 150 kB; embedded sample audio is stripped from the snapshot).
- **Pause and resume instead of a connection.** When the model needs something only the browser can do, the run ends with a *pause* and a signed token; the browser answers in a new request. The server never waits on a browser. See [How a turn works](agent-flow.md).
- **Validate in Python, not in the prompt.** The catalog is generated from the engine, so a jack that does not exist is refused immediately with a message that names the real ones. See [Edits and changesets](edits-and-changesets.md).
- **Pydantic AI as the framework.** The backend already uses Pydantic v2; the framework adds typed tools, validation with retries, streaming, external (deferred) tools and a test model, and supports the providers directly.

## Backend settings

Settings use the `BLEEP_` prefix and live in `website/api/app/config.py`.

| Setting | Default | Meaning |
|---|---|---|
| `agent_enabled` | `false` | Mounts the router. When off, `GET /api/agent/status` still answers `{"enabled": false}` and the board hides the chat |
| `agent_daily_tokens` | 1,000,000 | The site-wide daily budget; a run is refused with 429 when it is used up and `reset_at` is the next UTC midnight |
| `agent_model` | a Gemini flash model | The model the site uses |
| `agent_embed_model` | `gemini-embedding-2` | Must equal the model in `docs.sqlite`, otherwise documentation search falls back to keywords only |
| `agent_user_per_minute` | 6 | Per-user rate limit |
| `agent_max_steps` | 20 | The most model calls one run may make |
| `agent_state_secret` | random per process | HMAC key for resume tokens; set it when running more than one worker |

Provider keys are the providers' own variables, `GOOGLE_API_KEY` and `OPENAI_API_KEY`.

## The run log

Every run is logged so it can be debugged: the prompt, the board snapshot, every model call with the full messages sent and the usage, every tool call with its arguments and result, and every event. The log is a database table kept to the newest `BLEEP_AGENT_LOG_MESSAGES` rows (0 turns it off). The board's **Copy chat** button exports the transcript plus the server's log for the runs in it as one JSON document (`format: bleep-assistant-chat`), and the [benchmark](benchmark.md) writes the same shape for every case it runs. The log holds users' prompts and patches, so the privacy notice must say so.

## Further reading

- Formats and protocol, as built: `doc/specs/agent.md`
- Goals, reasoning and evaluation design: `doc/agent-concept.md`

## In the standalone app and the Bleep Board plugin

The assistant is the same panel (`agent-chat.js`) everywhere. Bleep Play is a page of the website and calls `/api/agent/…` with the session cookie. The app and the plugin serve their page themselves, so the page cannot call the website: it goes through the native `account` calls (`patch/library/Account.cpp`) to the library address from the settings, with the personal token from the OS keychain. The answer is a stream, which the page pulls piece by piece (`streamStart`, `streamRead`, `streamCancel`); `agent-chat.js` wraps it in a standard `Response`, so the rest of the panel does not know which transport it uses.

Signing in is the library login (device flow): the first time the panel opens without a login, a dialog shows a code to confirm on the website. Settings > Library has the same sign in and sign out; one login serves the app and every plugin. Instrument and FX plugin windows show only a cell's panel and have no assistant.
