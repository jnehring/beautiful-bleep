// SPDX-License-Identifier: MIT
"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/auth";
import { StoreImage } from "./StoreImage";

type Item = {
  kind: string; slug: string; version: string; channel: string; title: string; summary: string; category: string; image_url: string | null;
  notes: string; files: number; bytes: number; published_at: string | null;
};
type Page = { items: Item[]; categories: string[]; total: number; page: number; page_size: number };
const KINDS = [["", "All"], ["plugin", "Plugins"], ["module", "Modules"], ["preset", "Presets"]] as const;
const PAGE_SIZE = 24;
const KIND_LABEL: Record<string, string> = { plugin: "Plugin", module: "Module", preset: "Preset" };

/** The Bleep Store: everything published for download, free and without a login. */
export default function StorePage() {
  const [kind, setKind] = useState("");
  const [text, setText] = useState("");
  const [category, setCategory] = useState("");
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
    if (category) params.set("category", category);
    api<Page>("GET", `/store?${params}`).then((d) => { if (current) { setData(d); setError(""); } }, (e) => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [kind, category, q, page]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  return (
    <div className="admin">
      <h1>Bleep Store</h1>
      <p className="muted">Plugins, modules and presets. Everything is free and needs no login.</p>
      <div className="store-bar">
        <input type="search" placeholder="Search" aria-label="Search the store" value={text} onChange={(e) => setText(e.target.value)} />
        <div role="group" aria-label="Filter by type">
          {KINDS.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => { setKind(k); setCategory(""); setPage(1); }}>{label}</button>
          ))}
        </div>
      </div>
      {data && (data.categories?.length ?? 0) > 0 && (
        <div className="store-bar" role="group" aria-label="Filter by category">
          <button type="button" aria-pressed={category === ""} onClick={() => { setCategory(""); setPage(1); }}>Any category</button>
          {(data.categories ?? []).map((c) => (
            <button key={c} type="button" aria-pressed={category === c} onClick={() => { setCategory(c); setPage(1); }}>{c.replace(/\//g, " › ")}</button>
          ))}
        </div>
      )}
      {error ? <p className="error" role="alert">{error}</p> : !data ? <p>Loading…</p> : data.items.length === 0 ? <p className="muted">Nothing found.</p> : (
        <>
          <ul className="tiles">{data.items.map((i) => (
            <li key={i.kind + i.slug}>
              <a className="tile" href={`/store/detail/?kind=${i.kind}&slug=${encodeURIComponent(i.slug)}`}>
                <StoreImage kind={i.kind} title={i.title} src={i.image_url} />
                <span className="tile-body">
                  <span className="tile-tags"><span className={`tag tag-${i.kind}`}>{KIND_LABEL[i.kind] ?? i.kind}</span>{i.category && <span className="tag">{i.category.replace(/\//g, " › ")}</span>}</span>
                  <strong>{i.title}</strong>
                  <span className="tile-summary">{i.summary || "No description yet."}</span>
                  <small className="muted">{i.version}{i.channel !== "stable" && ` ${i.channel}`}</small>
                </span>
              </a>
            </li>
          ))}</ul>
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
