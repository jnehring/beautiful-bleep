// SPDX-License-Identifier: MIT
"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/auth";
import { Social } from "../Social";

type Version = { version: number; bytes: number; sha256: string; created_at: string };
type Patch = {
  pid: string; address: string; author_name: string; title: string; summary: string; type: string; tags: string[]; license: string;
  visibility: string; version: number; downloads: number; versions: Version[];
};

/** `/library/p/<pid>/<version>` (the server serves the detail page for it): one version of a shared patch, with its links. */
export function parsePatchPath(path: string): { pid: string; version: number } | null {
  const m = path.match(/^\/library\/p\/([a-z0-9]{10})(?:\/(\d+))?\/?$/);
  return m ? { pid: m[1], version: m[2] ? Number(m[2]) : 0 } : null;
}

function CopyRow({ label, text }: { label: string; text: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 2000); } catch { /* the field can be selected by hand */ }
  };
  return (
    <div className="copy-row">
      <label>{label}<input readOnly value={text} onFocus={(e) => e.currentTarget.select()} /></label>
      <button type="button" onClick={copy}>{done ? "Copied" : "Copy"}</button>
    </div>
  );
}

export function PatchView({ pid, version }: { pid: string; version: number }) {
  const [data, setData] = useState<Patch | null>(null);
  const [error, setError] = useState("");
  const [size, setSize] = useState({ w: 720, h: 420 });
  useEffect(() => {
    api<Patch>("GET", `/patches/${pid}`).then((p) => {
      if (version && !p.versions.some((v) => v.version === version)) { setError("This version does not exist."); return; }
      setData(p);
      if (!version) window.history.replaceState(null, "", `/library/p/${pid}/${p.version}`);   // a link without a version shows the newest
    }, (e) => setError(e.message));
  }, [pid, version]);
  if (error) return <><p><a href="/library/">← Bleep Library</a></p><p className="error" role="alert">{error}</p></>;
  if (!data) return <p>Loading…</p>;
  const v = version || data.version;
  const origin = window.location.origin;
  const q = `patch=${pid}&v=${v}`;
  const embed = `${origin}/embed/?${q}`;
  const iframe = `<iframe src="${embed}" width="${size.w}" height="${size.h}" allow="autoplay; midi; fullscreen" loading="lazy"></iframe>`;
  const isPrivate = data.visibility !== "public";
  return (
    <section>
      <p><a href="/library/">← Bleep Library</a></p>
      <h2>{data.title} <small className="muted">{data.type === "cell" ? "cell" : "project"} · version {v} · by {data.author_name}</small></h2>
      {isPrivate && <p className="notice" role="status">Private: only you can open this patch. Make it public in your account to share these links.</p>}
      {v !== data.version && <p className="notice">A newer version exists: <a href={`/library/p/${pid}/${data.version}`}>version {data.version}</a>. This page and its links show version {v}.</p>}
      <p>{data.summary || <span className="muted">No description yet.</span>}</p>
      {data.tags.length > 0 && <p>{data.tags.map((t) => <span key={t} className="tag">{t}</span>)}</p>}
      <p>
        <a className="play-button" href={`/play/index.html?${q}`} target="_blank" rel="noopener">Open in Play</a>
        {" "}<a href={`/api/patches/${pid}/${v}/file`} download>Download</a>
      </p>
      <p>License: <strong>{data.license}</strong></p>

      <h2>Links to version {v}</h2>
      <CopyRow label="Library page" text={`${origin}/library/p/${pid}/${v}`} />
      <CopyRow label="Play" text={`${origin}/play/?${q}`} />
      <h3>Embed</h3>
      <p className="muted">Paste this into a forum or a page: the patch shows there and starts when someone presses Play. It has a full screen button.</p>
      <p>
        <label>Width <input type="number" min={320} max={1600} value={size.w} onChange={(e) => setSize({ ...size, w: Number(e.target.value) || 720 })} /></label>{" "}
        <label>Height <input type="number" min={240} max={1200} value={size.h} onChange={(e) => setSize({ ...size, h: Number(e.target.value) || 420 })} /></label>
      </p>
      <CopyRow label="iframe code" text={iframe} />

      <h2>Versions</h2>
      <ul>{data.versions.map((x) => (
        <li key={x.version}>
          {x.version === v ? <strong>Version {x.version}</strong> : <a href={`/library/p/${pid}/${x.version}`}>Version {x.version}</a>}
          {" "}<small className="muted">{x.created_at.slice(0, 10)}</small>
        </li>
      ))}</ul>
      {!isPrivate && <Social kind="preset" slug={data.address} />}
    </section>
  );
}
