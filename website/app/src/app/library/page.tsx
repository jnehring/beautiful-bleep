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
/** A factory instrument or effect (/factory-presets.json): it ships with Bleep, so its tile opens it in Bleep Play instead of a detail page. */
type Factory = { name: string; category: string; description: string; roles: Role[]; polyphonic: boolean };
type Role = "instrument" | "effect";
// Instruments and Effects are presets with that role: the factory ones and the shared ones.
const KINDS = [["", "All"], ["instrument", "Instruments"], ["effect", "Effects"], ["plugin", "Plugins"], ["module", "Modules"], ["preset", "Presets"]] as const;
const isRole = (k: string): k is Role => k === "instrument" || k === "effect";
const HINT: Record<Role, string> = {
  instrument: "Factory instruments open in Bleep Play: play them with your computer keys (A W S E D F …), the piano at the bottom, or a MIDI keyboard. Instruments with several voices need a reasonably fast computer. In Ableton Live they load into Bleep Instrument.",
  effect: "Factory effects open in Bleep Play and play through a looping instrument, so you hear them at once; there you can switch to your microphone or an audio file. In Ableton Live they load into Bleep FX.",
};
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
  const [factory, setFactory] = useState<Factory[] | null>(null);
  const role = isRole(kind) ? kind : null;
  // The filter is in the address, so /library/?kind=instrument can be linked and survives a reload.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (kind) url.searchParams.set("kind", kind); else url.searchParams.delete("kind");
    window.history.replaceState(null, "", url);
  }, [kind]);
  useEffect(() => {
    if (!role || factory) return;
    fetch("/factory-presets.json").then((r) => (r.ok ? r.json() : [])).then(setFactory, () => setFactory([]));
  }, [role, factory]);

  useEffect(() => { const t = setTimeout(() => { setQ(text.trim()); setPage(1); }, 250); return () => clearTimeout(t); }, [text]);
  useEffect(() => {
    let current = true;
    // Instruments and effects: every shared preset with the role (they are few), merged with the factory ones and paged here.
    const params = role ? new URLSearchParams({ kind: "preset", role, page_size: "100" }) : new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
    if (kind && !role) params.set("kind", kind);
    if (q) params.set("q", q);
    if (category && !role) params.set("category", category);
    api<Page>("GET", `/library?${params}`).then((d) => { if (current) { setData(d); setError(""); } }, (e) => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [kind, role, category, q, page]);

  const list = role ? roleList(role, data, factory, q, category, page) : data;
  const cats = list?.categories ?? [];
  const topCats = [...new Set(cats.map((c) => c.split("/")[0]))].sort();
  const top = category.split("/")[0];
  const subCats = top ? cats.filter((c) => c.startsWith(top + "/")) : [];
  const pages = list ? Math.max(1, Math.ceil(list.total / list.page_size)) : 1;
  return (
    <div className="admin">
      <h1>Bleep Library</h1>
      <p className="muted">Instruments, effects, plugins, modules and presets. Everything is free and needs no login. <a href="/library/share/">Share a preset</a> (needs an account).</p>
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
      {role && <p className="muted">{HINT[role]}</p>}
      {error ? <p className="error" role="alert">{error}</p> : !list ? <p>Loading…</p> : list.items.length === 0 ? <p className="muted">Nothing found.</p> : (
        <>
          <ul className="lib-tiles">{list.items.map((i) => "roles" in i ? (
            <li key={"factory" + i.name}>
              <a className="lib-tile" href={`/play/index.html?play=${encodeURIComponent(i.name)}&as=${role}`} target="_blank" rel="noopener">
                <LibraryImage kind="preset" title={i.name} src={null} />
                <span className="lib-tile-body">
                  <span className="lib-tile-tags"><span className="tag tag-preset">Factory</span><span className="tag">{i.category.replace(/\//g, " › ")}</span></span>
                  <strong>{i.name}</strong>
                  <span className="lib-tile-summary">{i.description || "No description yet."}</span>
                  <span className="lib-tile-play"><span className="play-button">Play it</span>{i.polyphonic && <small className="muted"> polyphonic</small>}</span>
                </span>
              </a>
            </li>
          ) : (
            <li key={i.kind + i.slug}>
              <a className="lib-tile" href={`/library/detail/?kind=${i.kind}&slug=${encodeURIComponent(i.slug)}`}>
                <LibraryImage kind={i.kind} title={i.title} src={i.image_url} />
                <span className="lib-tile-body">
                  <span className="lib-tile-tags"><span className={`tag tag-${i.kind}`}>{KIND_LABEL[i.kind] ?? i.kind}</span>{i.category && <span className="tag">{i.category.replace(/\//g, " › ")}</span>}</span>
                  <strong>{i.title}</strong>
                  <span className="lib-tile-summary">{i.summary || "No description yet."}</span>
                  <small className="muted">{i.version}{i.channel !== "stable" && ` ${i.channel}`}</small>
                  <Stars average={i.rating_average} count={i.rating_count} />
                </span>
              </a>
            </li>
          ))}</ul>
          <nav className="pager" aria-label="Pages">
            <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Previous</button>
            <span>Page {list.page} of {pages} <small className="muted">({list.total} {list.total === 1 ? "entry" : "entries"})</small></span>
            <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next →</button>
          </nav>
        </>
      )}
    </div>
  );
}

/** The Instruments or Effects view: the factory presets with that role and the shared ones (their category without "Cells/", so
 * both are in one tree), filtered by search text and category, sorted by name and cut into pages. */
function roleList(role: Role, shared: Page | null, factory: Factory[] | null, q: string, category: string, page: number) {
  if (!shared || !factory) return null;
  const needle = q.toLowerCase();
  const own = factory.filter((f) => f.roles.includes(role) && (!needle || `${f.name} ${f.description} ${f.category}`.toLowerCase().includes(needle)));
  const all: (Item | Factory)[] = [...own, ...shared.items.map((i) => ({ ...i, category: i.category.replace(/^Cells\/?/, "") }))];
  const categories = [...new Set(all.map((i) => i.category).filter(Boolean))].sort();
  const title = (i: Item | Factory) => ("roles" in i ? i.name : i.title).toLowerCase();
  const items = all.filter((i) => !category || i.category === category || i.category.startsWith(category + "/")).sort((a, b) => title(a).localeCompare(title(b)));
  return { items: items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), categories, total: items.length, page, page_size: PAGE_SIZE };
}
