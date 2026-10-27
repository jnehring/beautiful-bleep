// SPDX-License-Identifier: MIT
"use client";
import { useEffect, useMemo, useRef, useState } from "react";

type Entry = { url: string; title: string; audience: string; text: string };
type Hit = { entry: Entry; score: number; snippet: string };

const MAX_HITS = 8;
const tokens = (q: string) => q.toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter(Boolean);

/** Every term must occur (prefix match on the last one is implied by substring search).
 *  Title hits weigh more than body hits; the snippet is centred on the first body match. */
function search(index: Entry[], query: string): Hit[] {
  const terms = tokens(query);
  if (!terms.length) return [];
  const hits: Hit[] = [];
  for (const entry of index) {
    const title = entry.title.toLowerCase();
    const body = entry.text.toLowerCase();
    let score = 0;
    let first = -1;
    let ok = true;
    for (const t of terms) {
      const inTitle = title.includes(t);
      const at = body.indexOf(t);
      if (!inTitle && at < 0) { ok = false; break; }
      if (inTitle) score += 10;
      if (at >= 0) {
        score += Math.min(body.split(t).length - 1, 5);
        if (first < 0 || at < first) first = at;
      }
    }
    if (!ok) continue;
    if (title.includes(query.toLowerCase().trim())) score += 5;
    const from = Math.max(0, (first < 0 ? 0 : first) - 40);
    const snippet = (from > 0 ? "… " : "") + entry.text.slice(from, from + 140) + (from + 140 < entry.text.length ? " …" : "");
    hits.push({ entry, score, snippet });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, MAX_HITS);
}

/** Splits `text` so the query terms can be wrapped in <mark>. */
function highlight(text: string, terms: string[]) {
  if (!terms.length) return text;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
}

export default function SearchBox() {
  const [index, setIndex] = useState<Entry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = () => {
    if (index || failed) return;
    fetch("/search-index.json").then((r) => r.json()).then(setIndex).catch(() => setFailed(true));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); input.current?.focus(); }
    };
    const onClick = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onClick); };
  }, []);

  const hits = useMemo(() => (index ? search(index, query) : []), [index, query]);
  const terms = useMemo(() => tokens(query), [query]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { setOpen(false); input.current?.blur(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && hits[active]) window.location.href = hits[active].entry.url;
  };

  return (
    <div className="search" ref={root}>
      <input
        ref={input} type="search" placeholder="Search" aria-label="Search the documentation"
        value={query} autoComplete="off"
        onFocus={() => { load(); setOpen(true); }}
        onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); }}
        onKeyDown={onKeyDown}
      />
      {open && query.trim() && (
        <ul className="search-results" role="listbox">
          {failed ? <li className="empty">Search is unavailable.</li>
            : !index ? <li className="empty">Loading…</li>
            : !hits.length ? <li className="empty">No results for “{query.trim()}”.</li>
            : hits.map((h, i) => (
              <li key={h.entry.url} role="option" aria-selected={i === active}>
                <a href={h.entry.url} className={i === active ? "active" : undefined} onMouseEnter={() => setActive(i)}>
                  <strong>{highlight(h.entry.title, terms)}</strong>
                  <span className="aud">{h.entry.audience}</span>
                  <small>{highlight(h.snippet, terms)}</small>
                </a>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
