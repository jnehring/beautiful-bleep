// SPDX-License-Identifier: MIT
"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/auth";
import { LibraryImage } from "../LibraryImage";
import { Social, Stars } from "../Social";
import { PatchView, parsePatchPath } from "./PatchView";

type File = { path: string; bytes: number; sha256: string; platform: string; uploaded: boolean };
type Origin = { name: string; author: string; url: string; license: string; copyright: string; changes?: string };
type Release = {
  version: string; license: string; channel: string; files: number; bytes: number; notes: string;
  requires: Record<string, unknown>; published_at: string | null; file_list: File[];
};
type Detail = { kind: string; slug: string; title: string; summary: string; category: string; image_url: string | null; rating_average: number | null; rating_count: number; license: string; origin: Origin | Record<string, never>; releases: Release[] };

type UsedIn = { count: number; items: { address: string; author_name: string; title: string; type: string }[] };

type Demos = { demos: { name: string; description: string; tags: string[]; order: number }[]; presets: { name: string; description: string }[] };

const day = (s: string | null, none = "—") => (s ? s.slice(0, 10) : none);
const size = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`);

export default function LibraryDetailPage() {
  return <div className="admin"><Suspense fallback={<p>Loading…</p>}><DetailView /></Suspense></div>;
}

function DetailView() {
  // /library/p/<pid>/<version> is this page too (the server rewrites it): one version of a shared patch.
  const [byId, setById] = useState<{ pid: string; version: number } | null | undefined>(undefined);
  useEffect(() => setById(parsePatchPath(window.location.pathname)), []);
  if (byId === undefined) return <p>Loading…</p>;
  if (byId) return <PatchView pid={byId.pid} version={byId.version} />;
  return <EntryView />;
}

function EntryView() {
  const params = useSearchParams();
  const kind = params.get("kind") ?? "";
  const slug = params.get("slug") ?? "";
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<Detail>("GET", `/library/${encodeURIComponent(kind)}/${kind === "preset" ? slug.split("/").map(encodeURIComponent).join("/") : encodeURIComponent(slug)}`).then(setData, (e) => setError(e.message));
  }, [kind, slug]);
  // Presets made from this one: shared presets list the presets they were copied from, and the library finds them again here.
  const [used, setUsed] = useState<UsedIn | null>(null);
  useEffect(() => {
    if (kind !== "preset") return;
    api<UsedIn>("GET", `/presets/${slug.split("/").map(encodeURIComponent).join("/")}/used-in`).then(setUsed, () => setUsed(null));
  }, [kind, slug]);
  // A module's five demo boards, each of which plays by itself in Bleep Play, and its presets.
  const [demos, setDemos] = useState<Demos | null>(null);
  useEffect(() => {
    if (kind !== "module") return;
    fetch(`/module-demos/${encodeURIComponent(slug)}`).then((r) => (r.ok ? r.json() : null)).then(setDemos, () => setDemos(null));
  }, [kind, slug]);
  const [doc, setDoc] = useState("");
  useEffect(() => {
    if (kind !== "module") return;
    fetch(`/module-docs/${encodeURIComponent(slug)}`).then((r) => (r.ok ? r.text() : "")).then((h) => setDoc(h.replace(/^\s*<h1[^>]*>.*?<\/h1>/s, "")), () => setDoc(""));
  }, [kind, slug]);
  if (error) return <p className="error" role="alert">{error}</p>;
  if (!data) return <p>Loading…</p>;
  // Table of contents: the sections above plus the headings of the module documentation (ids come from its HTML).
  const toc: { id: string; label: string; sub?: boolean }[] = [];
  if (demos?.demos.length) toc.push({ id: "examples", label: "Example patches" });
  if (demos?.presets.length) toc.push({ id: "presets", label: "Presets" });
  for (const m of doc.matchAll(/<h([23]) id="([^"]+)"[^>]*>(.*?)<\/h\1>/gs))
    toc.push({ id: m[2], label: m[3].replace(/<[^>]+>/g, "").replace(/&#39;/g, "'").replace(/&amp;/g, "&"), sub: m[1] === "3" });
  if (data.releases.length) toc.push({ id: "releases", label: "Releases" });
  const latest = data.releases.find((r) => r.channel === "stable") ?? data.releases[0];
  return (
    <section>
      <p><a href="/library/">← Bleep Library</a></p>
      <div className="detail-head">
        <LibraryImage kind={data.kind} title={data.title} src={data.image_url} large />
        <div>
          <h2>{data.title} <small className="muted">{data.kind} · {data.slug}</small></h2>
          {data.category && <p><span className="tag">{data.category.replace(/\//g, " › ")}</span></p>}
          <p>{data.summary || <span className="muted">No description yet.</span>}</p>
          <p><Stars average={data.rating_average} count={data.rating_count} /></p>
          {data.kind === "preset" && data.category === "Patches" && (
            <p><a className="play-button" href={`/play/index.html?preset=${encodeURIComponent(data.slug)}`} target="_blank" rel="noopener">Open in Play</a></p>
          )}
          <p>License: {data.license ? <strong>{data.license}</strong> : <span className="muted">not stated</span>}</p>
          {"name" in data.origin && (
            <p className="muted">
              Based on <a href={data.origin.url} rel="noopener noreferrer">{data.origin.name}</a> by {data.origin.author} ({data.origin.license}).
              {" "}{data.origin.copyright}{data.origin.changes ? ` Changes: ${data.origin.changes}` : ""}
            </p>
          )}
        </div>
      </div>
      {latest && (
        <dl className="facts" aria-label="Key facts">
          <div><dt>Version</dt><dd>{latest.version}{latest.channel !== "stable" && ` ${latest.channel}`}</dd></div>
          <div><dt>File size</dt><dd>{size(latest.bytes)}</dd></div>
          <div><dt>License</dt><dd>{latest.license || data.license || "not stated"}</dd></div>
        </dl>
      )}
      {used && used.count > 0 && (
        <>
          <h2>Used in {used.count} {used.count === 1 ? "preset" : "presets"}</h2>
          <ul>{used.items.map((i) => (
            <li key={i.address}><a href={`/library/detail/?kind=preset&slug=${encodeURIComponent(i.address)}`}>{i.title}</a> <small className="muted">by {i.author_name}</small></li>
          ))}</ul>
        </>
      )}
      {toc.length > 1 && (
        <nav className="toc" aria-label="Contents">
          <strong>Contents</strong>
          <ul>{toc.map((t) => <li key={t.id} className={t.sub ? "sub" : undefined}><a href={`#${t.id}`}>{t.label}</a></li>)}</ul>
        </nav>
      )}
      {demos && demos.demos.length > 0 && (
        <>
          <h2 id="examples">Example patches</h2>
          <ul className="examples">{demos.demos.map((d) => (
            <li key={d.name}>
              <a className="play-button" href={`/play/index.html?demo=${encodeURIComponent(d.name)}`} target="_blank" rel="noopener">Load in Play</a>
              <div><strong>{d.name}</strong>{d.description && <span className="muted"> {d.description}</span>}</div>
            </li>
          ))}</ul>
        </>
      )}
      {demos && demos.presets.length > 0 && (
        <>
          <h2 id="presets">Presets</h2>
          <ul>{demos.presets.map((p) => <li key={p.name}><strong>{p.name}</strong> <span className="muted">{p.description}</span></li>)}</ul>
        </>
      )}
      {doc && <article className="module-doc" dangerouslySetInnerHTML={{ __html: doc }} />}
      {data.releases.length > 0 && <h2 id="releases">Releases</h2>}
      {data.releases.map((r) => (
        <details key={r.version} className="release">
          <summary>
            <strong>{r.version}</strong> <small className="muted">{r.channel} · {r.license || "license not stated"} · {day(r.published_at)} · {r.files} {r.files === 1 ? "file" : "files"}, {size(r.bytes)}</small>
          </summary>
          {r.notes && <p>{r.notes}</p>}
          {Object.keys(r.requires).length > 0 && <p className="muted">Requires: <code>{JSON.stringify(r.requires)}</code></p>}
          <div className="scroll"><table>
            <thead><tr><th>File</th><th>Platform</th><th>Size</th><th>SHA-256</th><th>Uploaded</th></tr></thead>
            <tbody>{r.file_list.map((f) => (
              <tr key={f.path}>
                <td>{f.path.startsWith("/api/") ? <a href={f.path} download>Download</a> : f.path}</td><td>{f.platform}</td><td>{size(f.bytes)}</td>
                <td><code title={f.sha256}>{f.sha256.slice(0, 12)}…</code></td><td>{f.uploaded ? "yes" : "pending"}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </details>
      ))}
      <Social kind={data.kind} slug={data.slug} />
    </section>
  );
}
