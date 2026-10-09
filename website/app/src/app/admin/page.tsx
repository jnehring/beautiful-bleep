// SPDX-License-Identifier: MIT
"use client";
import { useCallback, useEffect, useState } from "react";
import { api, useUser } from "@/lib/auth";

type Token = { id: number; name: string; prefix: string; created_at: string; expires_at: string | null; last_used_at: string | null };
type Item = { slug: string; version: string; channel: string; status: string; title: string; files: number; bytes: number; published_at: string | null };
type Downloads = { plugins: Item[]; modules: Item[]; presets: Item[] };

const day = (s: string | null, none = "never") => (s ? s.slice(0, 10) : none);
const size = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export default function AdminPage() {
  const user = useUser();
  const [tab, setTab] = useState<"tokens" | "downloads">("tokens");
  useEffect(() => {
    if (user === null) window.location.href = "/login/";
  }, [user]);
  if (!user) return <p>Loading…</p>;
  if (user.role !== "admin") return <p className="error">Admins only.</p>;
  return (
    <div className="admin">
      <h1>Admin</h1>
      <nav className="tabs" aria-label="Admin">
        <button type="button" aria-current={tab === "tokens" ? "page" : undefined} onClick={() => setTab("tokens")}>Release tokens</button>
        <button type="button" aria-current={tab === "downloads" ? "page" : undefined} onClick={() => setTab("downloads")}>Downloads</button>
      </nav>
      {tab === "tokens" ? <Tokens /> : <DownloadsTab />}
    </div>
  );
}

function Tokens() {
  const [tokens, setTokens] = useState<Token[] | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => api<Token[]>("GET", "/admin/tokens").then(setTokens, (e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const create = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const days = String(f.get("days") ?? "").trim();
    setError("");
    try {
      const t = await api<{ token: string }>("POST", "/admin/tokens", { name: f.get("name"), expires_in_days: days ? Number(days) : null });
      setCreated(t.token);
      form.reset();
      load();
    } catch (err) { setError((err as Error).message); }
  };
  const revoke = async (t: Token) => {
    if (!confirm(`Revoke "${t.name}"? Scripts using it stop working.`)) return;
    try { await api("DELETE", `/admin/tokens/${t.id}`); load(); } catch (err) { setError((err as Error).message); }
  };

  return (
    <section>
      <p className="muted">Tokens let <code>scripts/release.py</code> publish plugins. A token is shown once, when it is created.</p>
      <form className="inline" onSubmit={create}>
        <label>Name<input name="name" maxLength={80} required placeholder="my laptop" /></label>
        <label>Expires after (days)<input name="days" type="number" min={1} max={3650} placeholder="never" /></label>
        <button type="submit">Create token</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      {created && (
        <div className="secret" role="status">
          <p><strong>Copy it now; it is not shown again.</strong></p>
          <code>{created}</code>{" "}
          <button type="button" onClick={() => navigator.clipboard?.writeText(created)}>Copy</button>{" "}
          <button type="button" onClick={() => setCreated(null)}>Done</button>
        </div>
      )}
      {tokens === null ? <p>Loading…</p> : tokens.length === 0 ? <p className="muted">No tokens yet.</p> : (
        <div className="scroll"><table>
          <thead><tr><th>Name</th><th>Token</th><th>Created</th><th>Expires</th><th>Last used</th><th /></tr></thead>
          <tbody>{tokens.map((t) => (
            <tr key={t.id}>
              <td>{t.name}</td><td><code>{t.prefix}…</code></td><td>{day(t.created_at)}</td>
              <td>{day(t.expires_at)}</td><td>{day(t.last_used_at)}</td>
              <td><button type="button" className="linklike" onClick={() => revoke(t)}>Revoke</button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
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
      <Group title="Plugins" items={data.plugins} />
      <Group title="Modules" items={data.modules} />
      <Group title="Presets" items={data.presets} />
    </section>
  );
}

function Group({ title, items }: { title: string; items: Item[] }) {
  return (
    <>
      <h2>{title} <small className="muted">({items.length})</small></h2>
      {items.length === 0 ? <p className="muted">None yet.</p> : (
        <div className="scroll"><table>
          <thead><tr><th>Name</th><th>Version</th><th>Channel</th><th>Status</th><th>Files</th><th>Size</th><th>Published</th></tr></thead>
          <tbody>{items.map((i) => (
            <tr key={i.slug + i.version}>
              <td>{i.title} <small className="muted">{i.slug}</small></td><td>{i.version}</td><td>{i.channel}</td>
              <td>{i.status}</td><td>{i.files}</td><td>{size(i.bytes)}</td><td>{day(i.published_at, "—")}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}
