// SPDX-License-Identifier: MIT
"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/auth";
import AdminGate from "../AdminGate";

type Token = { id: number; name: string; prefix: string; channels: string[]; created_at: string; expires_at: string | null; last_used_at: string | null };
type Person = { id: number; email: string; display_name: string; role: string; dev_access: boolean };
const day = (s: string | null, none = "never") => (s ? s.slice(0, 10) : none);

export default function TokensPage() {
  return <AdminGate title="Release tokens"><Tokens /><DevAccess /></AdminGate>;
}

/** Who may use the dev channel of the library (development builds from every push); admins always may. */
function DevAccess() {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => api<Person[]>("GET", "/admin/users").then(setPeople, (e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const set = async (p: Person, on: boolean) => {
    try { await api("PATCH", `/admin/users/${p.id}`, { dev_access: on }); load(); } catch (err) { setError((err as Error).message); }
  };
  return (
    <section>
      <h2>Dev channel</h2>
      <p className="muted">Accounts with dev access can switch Bleep App and the plugins to the dev channel (Settings → Library) and install the builds of every push to main. Admins always can.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {people === null ? <p>Loading…</p> : (
        <div className="scroll"><table>
          <thead><tr><th>Account</th><th>Dev access</th></tr></thead>
          <tbody>{people.map((p) => (
            <tr key={p.id}>
              <td>{p.display_name} <span className="muted">{p.email}</span></td>
              <td>{p.role === "admin" ? "always (admin)" : (
                <label><input type="checkbox" checked={p.dev_access} onChange={(e) => set(p, e.target.checked)} /> allowed</label>)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
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
      const t = await api<{ token: string }>("POST", "/admin/tokens", { name: f.get("name"), expires_in_days: days ? Number(days) : null, channels: String(f.get("channels")).split(",") });
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
      <p className="muted">Tokens let <code>scripts/release/release.py</code> publish plugins. A token is shown once, when it is created.</p>
      <form className="inline" onSubmit={create}>
        <label>Name<input name="name" maxLength={80} required placeholder="my laptop" /></label>
        <label>Expires after (days)<input name="days" type="number" min={1} max={3650} placeholder="never" /></label>
        <label>Releases into
          <select name="channels" defaultValue="stable,beta">
            <option value="stable,beta">stable and beta</option>
            <option value="dev">dev only (for the CI)</option>
          </select>
        </label>
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
          <thead><tr><th>Name</th><th>Token</th><th>Channels</th><th>Created</th><th>Expires</th><th>Last used</th><th /></tr></thead>
          <tbody>{tokens.map((t) => (
            <tr key={t.id}>
              <td>{t.name}</td><td><code>{t.prefix}…</code></td><td>{(t.channels ?? []).join(", ")}</td><td>{day(t.created_at)}</td>
              <td>{day(t.expires_at)}</td><td>{day(t.last_used_at)}</td>
              <td><button type="button" className="linklike" onClick={() => revoke(t)}>Revoke</button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}
