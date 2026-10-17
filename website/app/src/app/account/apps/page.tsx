// SPDX-License-Identifier: MIT
"use client";
import { useCallback, useEffect, useState } from "react";
import { api, useAccountUser } from "@/lib/auth";

type Token = { id: number; name: string; prefix: string; scope: string; created_at: string; expires_at: string | null; last_used_at: string | null };
const day = (s: string | null, none: string) => (s ? s.slice(0, 10) : none);

export default function AppsPage() {
  const user = useAccountUser();
  const [tokens, setTokens] = useState<Token[] | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => api<Token[]>("GET", "/tokens").then(setTokens, (e) => setError(e.message)), []);
  useEffect(() => { if (user) load(); }, [user, load]);
  if (!user) return <p>Loading…</p>;

  const create = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const days = String(f.get("days") ?? "").trim();
    setError("");
    try {
      const t = await api<{ token: string }>("POST", "/tokens", { name: f.get("name"), expires_in_days: days ? Number(days) : null });
      setCreated(t.token);
      form.reset();
      load();
    } catch (err) { setError((err as Error).message); }
  };
  const remove = async (t: Token) => {
    if (!confirm(`Remove "${t.name}"? It is signed out and stops working.`)) return;
    try { await api("DELETE", `/tokens/${t.id}`); load(); } catch (err) { setError((err as Error).message); }
  };

  return (
    <section className="admin">
      <h1>Apps &amp; devices</h1>
      <h2>Signed in</h2>
      <p className="muted">Apps and plugins you signed in to Bleep, and tokens you made for scripts. Remove one to sign it out.</p>
      <p>To sign in an app or plugin that shows a code, <a href="/device/">enter the code here</a>.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {tokens === null ? <p>Loading…</p> : tokens.length === 0 ? <p className="muted">None.</p> : (
        <table>
          <thead><tr><th>Name</th><th>Token</th><th>Created</th><th>Last used</th><th>Expires</th><th></th></tr></thead>
          <tbody>{tokens.map((t) => (
            <tr key={t.id}>
              <td>{t.name}</td><td><code>{t.prefix}…</code></td><td>{day(t.created_at, "—")}</td><td>{day(t.last_used_at, "never")}</td>
              <td>{day(t.expires_at, "never")}</td>
              <td><button type="button" className="linklike" onClick={() => remove(t)}>Remove</button></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <h2>New token for a script</h2>
      <form onSubmit={create} className="auth">
        <label>Name<input name="name" maxLength={80} placeholder="Upload script" required /></label>
        <label>Expires after <small>(days, empty = never)</small><input name="days" type="number" min={1} max={3650} /></label>
        <button type="submit">Create token</button>
      </form>
      {created && (
        <p role="status">Your token, shown once. Copy it now: <code>{created}</code></p>
      )}
    </section>
  );
}
