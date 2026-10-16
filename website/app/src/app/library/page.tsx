// SPDX-License-Identifier: MIT
"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/auth";
import { LibraryImage } from "./LibraryImage";
import { Stars } from "./Social";

type Item = {
  kind: string; slug: string; version: string; channel: string; title: string; summary: string; category: string; image_url: string | null;
  rating_average: number | null; rating_count: number;
  notes: string; files: number; bytes: number; published_at: string | null;
};
type Page = { items: Item[]; categories: string[]; total: number; page: number; page_size: number };
const KINDS = [["", "All"], ["plugin", "Plugins"], ["module", "Modules"], ["preset", "Presets"]] as const;
const PAGE_SIZE = 24;
const KIND_LABEL: Record<string, string> = { plugin: "Plugin", module: "Module", preset: "Preset" };

/** The Bleep Library: everything published for download, free and without a login. */
export default function LibraryPage() {
  const [kind, setKind] = useState("");
  useEffect(() => { const k = new URLSearchParams(window.location.search).get("kind"); if (k) setKind(k); }, []);
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
    api<Page>("GET", `/library?${params}`).then((d) => { if (current) { setData(d); setError(""); } }, (e) => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [kind, category, q, page]);

  const cats = data?.categories ?? [];
  const topCats = [...new Set(cats.map((c) => c.split("/")[0]))].sort();
  const top = category.split("/")[0];
  const subCats = top ? cats.filter((c) => c.startsWith(top + "/")) : [];
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  return (
    <div className="admin">
      <h1>Bleep Library</h1>
      <p className="muted">Plugins, modules and presets. Everything is free and needs no login. <a href="/library/share/">Share a preset</a> (needs an account).</p>
      <div className="library-bar">
        <input type="search" placeholder="Search" aria-label="Search the library" value={text} onChange={(e) => setText(e.target.value)} />
        <div role="group" aria-label="Filter by type">
          {KINDS.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => { setKind(k); setCategory(""); setPage(1); }}>{label}</button>
          ))}
        </div>
        {topCats.length > 0 && (
          <select aria-label="Filter by category" value={top} onChange={(e) => { setCategory(e.target.value); setPage(1); }}>
            <option value="">Any category</option>
            {topCats.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        {subCats.length > 0 && (
          <select aria-label="Filter by subcategory" value={category === top ? "" : category} onChange={(e) => { setCategory(e.target.value || top); setPage(1); }}>
            <option value="">All of {top}</option>
            {subCats.map((c) => <option key={c} value={c}>{c.slice(top.length + 1)}</option>)}
          </select>
        )}
      </div>
      {error ? <p className="error" role="alert">{error}</p> : !data ? <p>Loading…</p> : data.items.length === 0 ? <p className="muted">Nothing found.</p> : (
        <>
          <ul className="tiles">{data.items.map((i) => (
            <li key={i.kind + i.slug}>
              <a className="tile" href={`/library/detail/?kind=${i.kind}&slug=${encodeURIComponent(i.slug)}`}>
                <LibraryImage kind={i.kind} title={i.title} src={i.image_url} />
                <span className="tile-body">
                  <span className="tile-tags"><span className={`tag tag-${i.kind}`}>{KIND_LABEL[i.kind] ?? i.kind}</span>{i.category && <span className="tag">{i.category.replace(/\//g, " › ")}</span>}</span>
                  <strong>{i.title}</strong>
                  <span className="tile-summary">{i.summary || "No description yet."}</span>
                  <small className="muted">{i.version}{i.channel !== "stable" && ` ${i.channel}`}</small>
                  <Stars average={i.rating_average} count={i.rating_count} />
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
