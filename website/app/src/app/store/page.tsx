// SPDX-License-Identifier: MIT
"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/auth";

type Item = { kind: string; slug: string; version: string; channel: string; title: string; notes: string; files: number; bytes: number; published_at: string | null };
type Page = { items: Item[]; total: number; page: number; page_size: number };
const KINDS = [["", "All"], ["plugin", "Plugins"], ["module", "Modules"], ["preset", "Presets"]] as const;
const PAGE_SIZE = 20;
const day = (s: string | null) => (s ? s.slice(0, 10) : "—");
const size = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** The Bleep Store: everything published for download, free and without a login. */
export default function StorePage() {
  const [kind, setKind] = useState("");
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page | null>(null);
  const [error, setError] = useState("");

  useEffect(() => { const t = setTimeout(() => { setQ(text.trim()); setPage(1); }, 250); return () => clearTimeout(t); }, [text]);
  useEffect(() => {
    let current = true;
    const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
    if (kind) params.set("kind", kind);
    if (q) params.set("q", q);
    api<Page>("GET", `/store?${params}`).then((d) => { if (current) { setData(d); setError(""); } }, (e) => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [kind, q, page]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  return (
    <div className="admin">
      <h1>Bleep Store</h1>
      <p className="muted">Plugins, modules and presets. Everything is free and needs no login.</p>
      <div className="store-bar">
        <input type="search" placeholder="Search" aria-label="Search the store" value={text} onChange={(e) => setText(e.target.value)} />
        <div role="group" aria-label="Filter by type">
          {KINDS.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => { setKind(k); setPage(1); }}>{label}</button>
          ))}
        </div>
      </div>
      {error ? <p className="error" role="alert">{error}</p> : !data ? <p>Loading…</p> : data.items.length === 0 ? <p className="muted">Nothing found.</p> : (
        <>
          <div className="scroll"><table>
            <thead><tr><th>Name</th><th>Type</th><th>Version</th><th>Size</th><th>Published</th></tr></thead>
            <tbody>{data.items.map((i) => (
              <tr key={i.kind + i.slug}>
                <td><a href={`/store/detail/?kind=${i.kind}&slug=${encodeURIComponent(i.slug)}`}>{i.title}</a> <small className="muted">{i.slug}</small></td>
                <td>{i.kind}</td><td>{i.version}{i.channel !== "stable" && <small className="muted"> {i.channel}</small>}</td><td>{size(i.bytes)}</td><td>{day(i.published_at)}</td>
              </tr>
            ))}</tbody>
          </table></div>
          <nav className="pager" aria-label="Pages">
            <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Previous</button>
            <span>Page {data.page} of {pages} <small className="muted">({data.total} {data.total === 1 ? "entry" : "entries"})</small></span>
            <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next →</button>
          </nav>
        </>
      )}
    </div>
  );
}
