// SPDX-License-Identifier: MIT
"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/auth";
import AdminGate from "../AdminGate";

type Item = { slug: string; version: string; channel: string; status: string; title: string; files: number; bytes: number; published_at: string | null };
type Downloads = { plugins: Item[]; modules: Item[]; presets: Item[] };
const day = (s: string | null, none = "never") => (s ? s.slice(0, 10) : none);
const size = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export default function DownloadsPage() {
  return <AdminGate title="Downloads"><DownloadsTab /></AdminGate>;
}

function DownloadsTab() {
  const [data, setData] = useState<Downloads | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api<Downloads>("GET", "/admin/downloads").then(setData, (e) => setError(e.message)); }, []);
  if (error) return <p className="error" role="alert">{error}</p>;
  if (!data) return <p>Loading…</p>;
  return (
    <section>
      <p className="muted">What the registry offers for download. Everything is free and needs no login.</p>
      <Group title="Plugins" kind="plugin" items={data.plugins} />
      <Group title="Modules" kind="module" items={data.modules} />
      <Group title="Presets" kind="preset" items={data.presets} />
    </section>
  );
}

function Group({ title, kind, items }: { title: string; kind: string; items: Item[] }) {
  return (
    <>
      <h2>{title} <small className="muted">({items.length})</small></h2>
      {items.length === 0 ? <p className="muted">None yet.</p> : (
        <div className="scroll"><table>
          <thead><tr><th>Name</th><th>Version</th><th>Channel</th><th>Status</th><th>Files</th><th>Size</th><th>Published</th></tr></thead>
          <tbody>{items.map((i) => (
            <tr key={i.slug + i.version}>
              <td><a href={`/admin/downloads/detail/?kind=${kind}&slug=${encodeURIComponent(i.slug)}`}>{i.title}</a> <small className="muted">{i.slug}</small></td><td>{i.version}</td><td>{i.channel}</td>
              <td>{i.status}</td><td>{i.files}</td><td>{size(i.bytes)}</td><td>{day(i.published_at, "—")}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}
