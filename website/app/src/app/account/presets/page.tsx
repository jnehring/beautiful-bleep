// SPDX-License-Identifier: MIT
"use client";
import { useCallback, useEffect, useState } from "react";
import { api, useAccountUser } from "@/lib/auth";

type Preset = {
  id: number; pid: string; address: string; title: string; type: string; visibility: string; state: string; version: number; downloads: number;
  rating_average: number | null; rating_count: number; updated_at: string;
};

export default function MyPresetsPage() {
  const user = useAccountUser();
  const [presets, setPresets] = useState<Preset[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => api<Preset[]>("GET", "/presets/mine").then(setPresets, (e) => setError(e.message)), []);
  useEffect(() => { if (user) load(); }, [user, load]);
  if (!user) return <p>Loading…</p>;

  const act = async (run: () => Promise<unknown>) => {
    setError("");
    try { await run(); await load(); } catch (err) { setError((err as Error).message); }
  };
  const setVisibility = (p: Preset, visibility: "private" | "public") => act(() => api("PATCH", `/presets/${p.id}`, { visibility }));
  const remove = (p: Preset) => {
    if (!confirm(`Delete "${p.title}" with its comments and ratings? This cannot be undone.`)) return;
    return act(() => api("DELETE", `/presets/${p.id}`));
  };

  return (
    <section className="admin">
      <h1>Your presets</h1>
      <p className="muted">Patches you shared in the Bleep Library. A new patch is private: only you can open it until you make it public. Share new ones from the Share menu in Bleep.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {presets === null ? <p>Loading…</p> : presets.length === 0 ? <p className="muted">You have not shared a preset yet.</p> : (
        <table>
          <thead><tr><th>Title</th><th>Visibility</th><th>Type</th><th>Version</th><th>Downloads</th><th>Rating</th><th>Updated</th><th></th></tr></thead>
          <tbody>{presets.map((p) => (
            <tr key={p.id}>
              <td><a href={`/library/p/${p.pid}/${p.version}`}>{p.title}</a>{p.state !== "listed" && <small className="muted"> · removed by an admin</small>}</td>
              <td>{p.visibility}</td>
              <td>{p.type}</td>
              <td>{p.version}</td>
              <td>{p.downloads}</td>
              <td>{p.rating_average === null ? "—" : `${p.rating_average.toFixed(1)} (${p.rating_count})`}</td>
              <td>{p.updated_at.slice(0, 10)}</td>
              <td>
                {p.state === "listed" && (p.visibility === "public"
                  ? <><button type="button" className="linklike" onClick={() => setVisibility(p, "private")}>Make private</button>{" · "}</>
                  : <><button type="button" className="linklike" onClick={() => setVisibility(p, "public")}>Make public</button>{" · "}</>)}
                <button type="button" className="linklike" onClick={() => remove(p)}>Delete</button>
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {presets?.some((p) => p.state !== "listed") && <p className="muted"><small>A patch an admin removed is not in the library. Only an admin can list it again.</small></p>}
      <p className="muted"><small>Making a patch private or deleting it ends its links for everyone else: they see “This patch is no longer available.” Public patches are licensed CC BY 4.0.</small></p>
    </section>
  );
}
