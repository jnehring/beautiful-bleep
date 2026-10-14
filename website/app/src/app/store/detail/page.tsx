// SPDX-License-Identifier: MIT
"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/auth";
import { StoreImage } from "../StoreImage";
import { Social, Stars } from "../Social";

type File = { path: string; bytes: number; sha256: string; platform: string; uploaded: boolean };
type Origin = { name: string; author: string; url: string; license: string; copyright: string; changes?: string };
type Release = {
  version: string; license: string; channel: string; files: number; bytes: number; notes: string;
  requires: Record<string, unknown>; published_at: string | null; file_list: File[];
};
type Detail = { kind: string; slug: string; title: string; summary: string; category: string; image_url: string | null; rating_average: number | null; rating_count: number; license: string; origin: Origin | Record<string, never>; releases: Release[] };

const day = (s: string | null, none = "—") => (s ? s.slice(0, 10) : none);
const size = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`);

export default function StoreDetailPage() {
  return <div className="admin"><Suspense fallback={<p>Loading…</p>}><DetailView /></Suspense></div>;
}

function DetailView() {
  const params = useSearchParams();
  const kind = params.get("kind") ?? "";
  const slug = params.get("slug") ?? "";
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<Detail>("GET", `/store/${encodeURIComponent(kind)}/${kind === "preset" ? slug.split("/").map(encodeURIComponent).join("/") : encodeURIComponent(slug)}`).then(setData, (e) => setError(e.message));
  }, [kind, slug]);
  const [doc, setDoc] = useState("");
  useEffect(() => {
    if (kind !== "module") return;
    fetch(`/module-docs/${encodeURIComponent(slug)}`).then((r) => (r.ok ? r.text() : "")).then((h) => setDoc(h.replace(/^\s*<h1[^>]*>.*?<\/h1>/s, "")), () => setDoc(""));
  }, [kind, slug]);
  if (error) return <p className="error" role="alert">{error}</p>;
  if (!data) return <p>Loading…</p>;
  const latest = data.releases.find((r) => r.channel === "stable") ?? data.releases[0];
  return (
    <section>
      <p><a href="/store/">← Bleep Store</a></p>
      <div className="detail-head">
        <StoreImage kind={data.kind} title={data.title} src={data.image_url} large />
        <div>
          <h2>{data.title} <small className="muted">{data.kind} · {data.slug}</small></h2>
          {data.category && <p><span className="tag">{data.category.replace(/\//g, " › ")}</span></p>}
          <p>{data.summary || <span className="muted">No description yet.</span>}</p>
          <p><Stars average={data.rating_average} count={data.rating_count} /></p>
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
      {doc && <article className="module-doc" dangerouslySetInnerHTML={{ __html: doc }} />}
      {data.releases.length > 0 && <h2>Releases</h2>}
      {data.releases.map((r) => (
        <div key={r.version} className="release">
          <h3>{r.version} <small className="muted">{r.channel} · {r.license || "license not stated"} · published {day(r.published_at)} · {r.files} {r.files === 1 ? "file" : "files"}, {size(r.bytes)}</small></h3>
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
        </div>
      ))}
      <Social kind={data.kind} slug={data.slug} />
    </section>
  );
}
