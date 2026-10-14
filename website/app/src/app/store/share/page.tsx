// SPDX-License-Identifier: MIT
"use client";
import { useEffect, useState } from "react";
import { api, useUser } from "@/lib/auth";

type Published = { address: string; version: number; title: string };

/** Shares a preset from the website: a `.bleeppreset` (or a bare preset JSON) saved from the board. The apps do the same from *Share…*. */
export default function SharePage() {
  const user = useUser();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Published | null>(null);
  useEffect(() => { if (user === null) window.location.href = `/login/?next=${encodeURIComponent("/store/share/")}`; }, [user]);
  if (!user) return <p>Loading…</p>;

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const file = f.get("file") as File;
    setBusy(true); setError("");
    try {
      let doc: any;
      try { doc = JSON.parse(await file.text()); } catch { throw new Error("That file is not JSON"); }
      const preset = doc && typeof doc.preset === "object" && doc.preset ? doc.preset : doc;
      const tags = String(f.get("tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean);
      const slug = String(f.get("slug") ?? "").trim();
      setDone(await api<Published>("POST", "/presets", {
        title: f.get("title"), summary: f.get("summary"), type: f.get("type"), license: f.get("license"), tags, preset,
        ...(slug && { slug }),
      }));
    } catch (err) { setError((err as Error).message); }
    setBusy(false);
  };

  if (done) return (
    <div className="auth">
      <h1>Shared</h1>
      <p className="ok" role="status">“{done.title}” is in the store as version {done.version}.</p>
      <p><a href={`/store/detail/?kind=preset&slug=${encodeURIComponent(done.address)}`}>Open it</a> · <a href="/store/share/" onClick={() => setDone(null)}>Share another</a></p>
    </div>
  );
  return (
    <form className="auth" onSubmit={submit}>
      <h1>Share a preset</h1>
      <p className="muted">Anyone can download it. To publish a new version of one of your presets, enter its address name (the last part of its address).</p>
      <label>Preset file<input name="file" type="file" accept=".bleeppreset,.json,application/json" required /></label>
      <label>Title<input name="title" maxLength={120} required /></label>
      <label>Description<textarea name="summary" maxLength={280} rows={3} /></label>
      <label>Type<select name="type" defaultValue="patch"><option value="patch">Patch (a whole board)</option><option value="cell">Cell</option></select></label>
      <label>Tags <small>(comma separated)</small><input name="tags" /></label>
      <label>License<select name="license" defaultValue="CC-BY-4.0"><option value="CC-BY-4.0">CC BY 4.0 (credit me)</option><option value="CC0-1.0">CC0 (public domain)</option></select></label>
      <label>Address name <small>(optional; new version of an existing preset)</small><input name="slug" pattern="[a-z0-9][a-z0-9\-]*" maxLength={64} /></label>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" disabled={busy}>Share</button>
    </form>
  );
}
