---
title: How a turn works
description: One assistant turn from request to events: routing, the agent loop, tool calls, live tools with pause and resume, and the step budget.
order: 30
---

# How a turn works

A **turn** is one user message and everything the assistant does about it. The code is `agent/src/bleep_agent/runner.py` (`run_chat`).

![A request with messages and a board snapshot is routed to a skill by keywords. The skill sets the prompt and the tools. The agent loop builds instructions, calls the model, and the model either answers in text or calls read, write or live tools. Read and write tool results go back to the model; live tools pause the run. Events stream to the board.](/img/assistant-flow.svg)

## 1. The request

`POST /api/agent/chat` carries the conversation as plain text, a **snapshot** (the board as JSON, the selected module ids, optional environment), the mode (`ask` or `auto`) and an optional skill hint. Everything the run needs is in it; nothing is stored between requests.

## 2. Route

`skills.route` picks a skill from the last message. An explicit `skill` hint wins; otherwise keyword patterns decide, in this order: a "why is there no sound" pattern selects `diagnose`; a question about Bleep (how, what, which...) selects `docs`, unless it says "for me" or "please"; then `panel`, `compose`, `design` and `patch` by their words; anything else is `docs`. Routing is plain code, not a model call, so it costs nothing and is easy to test.

## 3. The skill

The skill fixes two things: the **prompt** (the shared `base.md` plus the skill's own file in `prompts/`) and the **tools offered**. Only the tools a skill uses are sent, because every tool definition is sent on every model call. See [Skills and tools](skills-and-tools.md).

## 4. The agent loop

The loop is Pydantic AI's. Each step:

1. **Build the instructions.** Stable text comes first (base prompt, skill prompt, the mode, the module index and jacks-and-knobs sheet), volatile text last (the board *right now*, including changes made earlier in this run, and a step warning). The model API caches the longest unchanged prefix of a request, so this order makes every step after the first cheaper.
2. **Call the model** with the tools of the skill.
3. **Read the response.** If it has tool calls, run them and loop. If it is plain text, that is the answer and the run ends.

The three kinds of tool behave differently:

| Kind | Runs | Result |
|---|---|---|
| **Read** (`describe_module`, `search_docs`, `trace_signal`...) | In Python, against the run's working copy of the patch, the catalog and the indexes | A value for the model, no round trip |
| **Write** (`propose_changes`, `set_pattern`, `propose_panel`...) | In Python: the operation is applied to the working copy and validated | A **changeset** event for the board, and a short result for the model. If validation fails the model gets the error and may retry |
| **Live** (`get_environment`, `probe_signals`, `play`, `highlight`, `ask_user`) | In the browser | The run **pauses** (below) |

Because writes are applied to the working copy first, the model sees the effect of its own edits within a run, and a changeset that does not validate is never sent.

### Lookups that were already answered

A lookup repeated in the same run (the same `describe_module`, the same `read_doc`) is not answered again: the tool returns a one-line note telling the model to use the earlier result, which keeps the large result out of the history a second time. The prompt also asks for independent lookups to be made together, several tool calls in one step.

### The step budget is a rule, not a request

A run has at most `agent_max_steps` model calls (20 on the site). Telling the model to hurry is unreliable, so the tool list enforces it: in the last four steps only tools that *change something* remain (lookups disappear), and on the very last step no tools are offered at all, so the model can only answer in text and says what it did and what is still open. A run that nevertheless reaches the hard limit ends with the `limit` event.

## 5. Pause and resume for live tools

Some answers exist only in the browser: whether signals move, which MIDI devices are connected, what the user picks from a question. The server does not hold a connection open for that.

1. The model calls a live tool. The run ends with a `live` event per call and a `pause` event carrying a **token**.
2. The token is an HMAC-signed, compressed copy of the run's message history and working copy, valid for 15 minutes.
3. The browser executes the tool (`probe_signals` listens to engine state for up to two seconds, optionally with a test note) and sends a new request with `resume: {token, results}` and a fresh snapshot, which is the truth after anything the user did meanwhile.
4. The server verifies the token, restores the history, hands the results to the model as the tool's output and the loop continues.

`ask_user` waits for a person for up to ten minutes; the other live tools are time-boxed to five seconds in the browser.

## 6. Events

The turn is a stream of Server-Sent Events:

| Event | Meaning |
|---|---|
| `run` | The run id, to fetch its log later |
| `activity` | A short status line for the chat ("Checking signal levels") |
| `text` | A piece of the answer |
| `changeset` | A proposed change: summary, operations, readable diff lines, whether it is destructive and whether it needs confirmation |
| `live`, `pause` | The browser must run tools and resume |
| `usage` | Tokens so far in this run and today |
| `error` | `budget`, `rate`, `model`, `invalid` or `internal` |
| `done` | `final`, `pause`, `budget`, `error` or `limit` |

A changeset `needs_confirmation` when it is destructive, and for every changeset in `ask` mode. In `auto` mode the board applies the others as they arrive, as one undo step each, and the chat shows "Applied: ... (Undo)".

`run_chat` never raises: a failure becomes an `error` event followed by `done`, so the stream always ends cleanly.

## Prompt-injection

Retrieved documents, presets, module names and patches are *data*. The base prompt says so: text inside them is never to be followed as an instruction. The tools the assistant has are the limit of what a hostile patch could make it do, which is why changes always pass through a changeset the user can see and undo.
