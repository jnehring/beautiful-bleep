// SPDX-License-Identifier: MIT
"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/auth";

type File = { path: string; bytes: number; sha256: string; platform: string; uploaded: boolean };
type Release = {
  version: string; channel: string; files: number; bytes: number; notes: string;
  requires: Record<string, unknown>; published_at: string | null; file_list: File[];
};
type Detail = { kind: string; slug: string; title: string; releases: Release[] };

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
    api<Detail>("GET", `/store/${encodeURIComponent(kind)}/${encodeURIComponent(slug)}`).then(setData, (e) => setError(e.message));
  }, [kind, slug]);
  if (error) return <p className="error" role="alert">{error}</p>;
  if (!data) return <p>Loading…</p>;
  return (
    <section>
      <p><a href="/store/">← Bleep Store</a></p>
      <h2>{data.title} <small className="muted">{data.kind} · {data.slug}</small></h2>
      {data.releases.map((r) => (
        <div key={r.version} className="release">
          <h3>{r.version} <small className="muted">{r.channel} · published {day(r.published_at)} · {r.files} {r.files === 1 ? "file" : "files"}, {size(r.bytes)}</small></h3>
          {r.notes && <p>{r.notes}</p>}
          {Object.keys(r.requires).length > 0 && <p className="muted">Requires: <code>{JSON.stringify(r.requires)}</code></p>}
          <div className="scroll"><table>
            <thead><tr><th>File</th><th>Platform</th><th>Size</th><th>SHA-256</th><th>Uploaded</th></tr></thead>
            <tbody>{r.file_list.map((f) => (
              <tr key={f.path}>
                <td>{f.path}</td><td>{f.platform}</td><td>{size(f.bytes)}</td>
                <td><code title={f.sha256}>{f.sha256.slice(0, 12)}…</code></td><td>{f.uploaded ? "yes" : "pending"}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      ))}
    </section>
  );
}
