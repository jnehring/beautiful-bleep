# bleep-agent

The Bleep patch assistant as a Python library: module catalog, patch model, validated edit operations, tools, skills, the agent loop
(Pydantic AI), the documentation index (RAG) and the evaluation workbench. Concept: [doc/agent-concept.md](../doc/agent-concept.md).
Formats and protocol: [doc/specs/agent.md](../doc/specs/agent.md). The web API mounts it in `website/api/app/routers/agent.py`;
the chat panel is `patch/board/ui/agent-chat.js`.

## Set up

```bash
python3 -m venv .venv-agent && .venv-agent/bin/pip install -e "agent[dev]"
PYTHON=.venv-agent/bin/python scripts/build/build-agent-data.sh                    # catalog.json, presets.jsonl, docs.sqlite (keyword search)
PYTHON=.venv-agent/bin/python scripts/build/build-agent-data.sh --embed gemini-embedding-2   # + embeddings (GEMINI_API_KEY; cached)
.venv-agent/bin/pytest agent/tests
```

Switching it on in the site: `BLEEP_AGENT_ENABLED=true`, `BLEEP_AGENT_API_KEY`, the daily budget `BLEEP_AGENT_DAILY_TOKENS`
(see `website/.env.example`). Off by default.

## Try it

```bash
.venv-agent/bin/bleep-agent chat "add chorus and reverb between the synth and the output" --preset additive-osc-tilt-sweep --model gemini-3.8-flash
```

## Evaluate

```bash
.venv-agent/bin/bleep-agent eval generate                                   # regenerate evals/cases/*/generated.yaml
.venv-agent/bin/bleep-agent eval run --models gemini-3.8-flash,gpt-6-luna --repeats 3 --judge gemini-4-argon
.venv-agent/bin/bleep-agent eval report evals/runs/<run> [--compare evals/runs/<other>]
.venv-agent/bin/bleep-agent eval retrieval --embed gemini-embedding-2        # documentation retrieval on its own
```

Every model, judge and embedding call goes through the cache in `.eval-cache/` (`--cache use|refresh|replay-only|off`), so an
unchanged rerun costs nothing and a changed prompt re-runs only what depends on it. Fill `src/bleep_agent/evals/prices.yaml`
for cost figures; until then reports show tokens and `n/a`.
