# SPDX-License-Identifier: MIT
"""Log files of benchmark runs: per run one JSON (same shape as the assistant's "Copy chat" export: transcript + the run log rows)
and one Markdown rendering of it, so a run can be read, diffed and fed back into prompt and tool work."""
from __future__ import annotations

import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pydantic_core import to_jsonable_python

FORMAT = "bleep-benchmark-run"
NOTES = ("transcript = the simulated user's request and the assistant's final answer with its changesets. runs = the agent's log of each request "
         "(a run that paused for a browser tool and was resumed is several runs), in order: run_start (prompt, board snapshot), model_call "
         "(request = messages sent to the model incl. instructions; response; usage; latency in seconds), tool_call (args, result or retry error), "
         "event, answer. To save space a model_call lists only the messages that are new since the previous call of the run "
         "(request_first_messages_same_as_previous_call = how many leading messages repeat). result = checks, judge and totals as in results.jsonl.")
MD_BLOCK = 4000  # characters of one tool argument / result shown in the Markdown (the JSON has everything)


class RunRecorder:
    """record(kind, data) callback for run_chat: rows as the production run log keeps them ({id, at, kind, data})."""

    def __init__(self) -> None:
        self.rows: list[dict[str, Any]] = []

    def __call__(self, kind: str, data: dict[str, Any]) -> None:
        self.rows.append({"id": len(self.rows) + 1, "at": datetime.now(timezone.utc).isoformat(), "kind": kind, "data": to_jsonable_python(data)})


def dedupe_calls(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Each model call repeats the whole history; keep only what is new since the previous call (as the chat export does)."""
    prev: list[Any] | None = None
    out = []
    for r in rows:
        d = r.get("data")
        if r["kind"] != "model_call" or not isinstance(d, dict) or not isinstance(d.get("request"), list):
            out.append(r)
            continue
        cur, was, prev = d["request"], prev, d["request"]
        n = 0
        if was is not None:
            while n < len(was) and n < len(cur) and was[n] == cur[n]:
                n += 1
        if not n:
            out.append(r)
            continue
        rest = {k: v for k, v in d.items() if k != "request"}
        out.append({**r, "data": {**rest, "request_new_messages": cur[n:], "request_first_messages_same_as_previous_call": n}})
    return out


def run_document(result: dict[str, Any], log: dict[str, Any]) -> dict[str, Any]:
    """The JSON document of one benchmark run. `log` is what run_case collected: case, transcript, runs (run_id + rows)."""
    return {"format": FORMAT, "version": 1, "exported_at": datetime.now(timezone.utc).isoformat(), "notes": NOTES,
            "case": log["case"], "transcript": log["transcript"], "result": result,
            "runs": [{"run_id": r["run_id"], "rows": dedupe_calls(r["rows"])} for r in log["runs"]]}


def _clip(text: str, limit: int = MD_BLOCK) -> str:
    return text if len(text) <= limit else text[:limit] + f"\n… [{len(text) - limit} more characters, see the JSON]"


def _json(x: Any) -> str:
    return json.dumps(x, indent=1, ensure_ascii=False, default=str)


def _fence(text: str, lang: str = "") -> str:
    ticks = "```"
    while ticks in text:
        ticks += "`"
    return f"{ticks}{lang}\n{text}\n{ticks}"


def _details(summary: str, body: str) -> str:
    return f"<details><summary>{summary}</summary>\n\n{body}\n\n</details>"


def _message_md(m: dict[str, Any]) -> list[str]:
    out: list[str] = []
    for p in m.get("parts", []):
        kind = p.get("part_kind")
        if kind == "system-prompt":
            out.append("**system prompt**\n\n" + _fence(_clip(str(p.get("content")), 20000)))
        elif kind == "user-prompt":
            out.append("**user**\n\n" + _fence(_clip(str(p.get("content")))))
        elif kind == "tool-return":
            out.append(f"**tool result** `{p.get('tool_name')}`\n\n" + _fence(_clip(str(p.get("content") if isinstance(p.get("content"), str) else _json(p.get("content")))), "json"))
        elif kind == "retry-prompt":
            out.append(f"**retry request** `{p.get('tool_name') or ''}`\n\n" + _fence(_clip(str(p.get("content")))))
        elif kind == "text":
            out.append("**assistant**\n\n" + str(p.get("content")))
        elif kind == "tool-call":
            args = p.get("args")
            out.append(f"**tool call** `{p.get('tool_name')}`\n\n" + _fence(_clip(args if isinstance(args, str) else _json(args)), "json"))
        elif kind == "thinking":
            out.append(_details("thinking", _fence(_clip(str(p.get("content"))))))
        else:
            out.append(_fence(_clip(_json(p)), "json"))
    return out


def _run_md(run: dict[str, Any], index: int) -> list[str]:
    md = [f"### Request {index}"]
    first_call = True
    n_call = 0
    for r in run["rows"]:
        k, d = r["kind"], r["data"]
        t = r["at"][11:23]
        if k == "run_start":
            md.append(f"`{t}` **run start** · skill `{d.get('skill')}` · mode `{d.get('mode')}` · model `{d.get('model')}` · resume `{d.get('resume')}` · max steps {d.get('max_steps')}")
            if d.get("prompt"):
                md.append("**user**\n\n" + _fence(d["prompt"]))
            snap = (d.get("snapshot") or {})
            md.append(f"board snapshot: {len((snap.get('patch') or {}).get('nodes', []))} modules, {len((snap.get('patch') or {}).get('cables', []))} cables, selection {snap.get('selection')}"
                      + " (full board in the JSON)")
            if d.get("live_results"):
                md.append(_details("results of the browser tools this request resumed with", _fence(_clip(_json(d["live_results"])), "json")))
        elif k == "model_call":
            n_call += 1
            u = d.get("usage") or {}
            head = f"`{t}` **model call {n_call}** · {d.get('latency')}s · in {u.get('input_tokens', '?')} / out {u.get('output_tokens', '?')}"
            if d.get("error"):
                head += f" · **ERROR** {d['error']}"
            md.append(head)
            if first_call:
                first_call = False
                msgs = d.get("request") or d.get("request_new_messages") or []
                inst = next((m.get("instructions") for m in msgs if m.get("instructions")), None)
                if inst:
                    md.append(_details("instructions sent to the model", _fence(_clip(inst, 30000))))
                tools = d.get("tools")
                if tools:
                    md.append("tools offered: " + ", ".join(f"`{x}`" for x in tools))
            resp = d.get("response")
            if resp:
                md.extend(_message_md(resp))
        elif k == "tool_call":
            args = _fence(_clip(_json(d.get("args"))), "json")
            if d.get("retry"):
                md.append(f"`{t}` **tool `{d.get('tool')}` → RETRY** ({d.get('duration')}s)\n\nargs:\n\n{args}\n\nerror: {_fence(_clip(str(d.get('error'))))}")
            else:
                res = d.get("result")
                md.append(f"`{t}` **tool `{d.get('tool')}`** ({d.get('duration')}s)\n\nargs:\n\n{args}\n\nresult:\n\n"
                          + _fence(_clip(res if isinstance(res, str) else _json(res)), "json"))
        elif k == "event":
            name, data = d.get("name"), d.get("data") or {}
            if name == "changeset":
                md.append(f"`{t}` **changeset** {data.get('summary')!r}\n\n" + _fence("\n".join(data.get("lines") or [])))
            elif name == "error":
                md.append(f"`{t}` **error** `{data.get('code')}`: {data.get('message')}")
            elif name == "live":
                md.append(f"`{t}` **browser tool requested** `{data.get('tool')}` {json.dumps(data.get('args'), ensure_ascii=False)}")
            elif name == "done":
                md.append(f"`{t}` **done** · {data.get('reason')}")
        elif k == "answer":
            md.append(f"`{t}` **answer**\n\n" + str(d.get("text")))
    return md


def run_markdown(doc: dict[str, Any]) -> str:
    res, case = doc["result"], doc["case"]
    verdict = "PASS" if res["success"] else "FAIL"
    md = [f"# {res['case']} · {res['model']} · repeat {res['repeat']} — {verdict}", "",
          f"- skill `{res['skill']}`, difficulty `{res['difficulty']}`, mode `{case.get('mode')}`",
          f"- score {res['score']:.2f}" + (f", judge {res['judge']['score']:.2f}" if isinstance(res.get("judge"), dict) and "score" in res["judge"] else ""),
          f"- {res['calls']} model calls ({res['cached_calls']} replayed from the cache), tokens in {res['tokens_in']} / out {res['tokens_out']}, "
          f"model time {res['latency']:.1f}s, wall {res['wall']:.1f}s",
          f"- tools: {' > '.join(res['tools']) or 'none'} ({res['retries']} retried)",
          f"- exported {doc['exported_at']}", "",
          "## Request", "", _fence(case.get("query", "")), ""]
    if case.get("selection"):
        md += [f"selection: {case['selection']}", ""]
    if case.get("gold"):
        md += ["reference (gold): ", _fence(_json(case["gold"]), "json"), ""]
    md += ["## Result", ""]
    if res["checks"]:
        md += ["| | check | detail |", "|---|---|---|"]
        for c in res["checks"]:
            rest = {k: v for k, v in c.items() if k not in ("ok", "kind", "name")}
            md.append(f"| {'✅' if c.get('ok') else '❌'} | `{c.get('name') or c.get('kind')}` | {str(c.get('detail') or c.get('message') or (rest if rest else '')).replace('|', '/')[:300]} |")
        md.append("")
    if res.get("errors"):
        md += ["errors:", _fence(_json(res["errors"]), "json"), ""]
    j = res.get("judge")
    if isinstance(j, dict):
        md += ["judge:", ""]
        md.append(f"- error: {j['error']}" if "error" in j else f"- score {j.get('score')} (raw {j.get('raw')}): {j.get('reasoning')}")
        for i in j.get("issues") or []:
            md.append(f"  - {i}")
        md.append("")
    md += ["changesets: " + ("; ".join(res["changesets"]) or "none"), "", "final answer:", "", _fence(res.get("answer") or "(empty)"), "", "## Run log", ""]
    for i, run in enumerate(doc["runs"], 1):
        for block in _run_md(run, i):
            md += [block, ""]
    return "\n".join(md).rstrip() + "\n"


def safe(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", name)


def log_path(log_dir: Path, result: dict[str, Any]) -> Path:
    """Without extension: <log_dir>/<model>/<skill>/<case>.r<repeat>"""
    return log_dir / safe(result["model"]) / safe(result["skill"]) / f"{safe(result['case'])}.r{result['repeat']}"


def write_run_logs(log_dir: Path, result: dict[str, Any], log: dict[str, Any]) -> Path:
    doc = run_document(result, log)
    base = log_path(log_dir, result)
    base.parent.mkdir(parents=True, exist_ok=True)
    base.with_suffix(base.suffix + ".json").write_text(json.dumps(doc, indent=1, ensure_ascii=False, default=str) + "\n")
    base.with_suffix(base.suffix + ".md").write_text(run_markdown(doc))
    return base


def write_index(log_dir: Path, results: list[dict[str, Any]]) -> None:
    """logs/index.md: every run on one line with links, failures first within a model."""
    md = ["# Run logs", "", f"{len(results)} runs, written {time.strftime('%Y-%m-%d %H:%M')}. Each run has a `.md` (to read) and a `.json` (the full record).", "",
          "| | model | skill | case | repeat | calls | tokens in / out | tools | log |", "|---|---|---|---|---|---|---|---|---|"]
    for r in sorted(results, key=lambda r: (r["model"], r["success"], r["skill"], r["case"], r["repeat"])):
        rel = log_path(log_dir, r).relative_to(log_dir).as_posix()
        md.append(f"| {'✅' if r['success'] else '❌'} | {r['model']} | {r['skill']} | {r['case']} | {r['repeat']} | {r['calls']} | {r['tokens_in']} / {r['tokens_out']} | "
                  f"{' > '.join(r['tools'])[:80]} | [md]({rel}.md) · [json]({rel}.json) |")
    (log_dir / "index.md").write_text("\n".join(md) + "\n")
