// SPDX-License-Identifier: MIT
"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/auth";

type File = { path: string; bytes: number; sha256: string; platform: string; uploaded: boolean };
type Release = { version: string; channel: string; file_list: File[] };
type Detail = { releases: Release[] };

/** The Bleep App is a store entry like any plugin (kind plugin, id bleep-app); its files are one build per platform. */
const APP = "/store/plugin/bleep-app";
const SYSTEMS = [
  { id: "macos", label: "macOS", note: "macOS 12 or later", builds: { "macos-arm64": "Apple silicon", "macos-x86_64": "Intel" } },
  { id: "windows", label: "Windows", note: "Windows 10 or later, 64-bit", builds: { "windows-x86_64": "64-bit" } },
  { id: "linux", label: "Linux", note: "64-bit, PulseAudio or PipeWire", builds: { "linux-x86_64": "64-bit" } },
] as const;

const size = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(0)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const href = (version: string, path: string) =>
  `/registry/v1/plugins/bleep-app/${version}/${path.split("/").map(encodeURIComponent).join("/")}`;

/** The visitor's system, to put its download first. */
function detect(): string {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return "windows";
  if (/Mac/i.test(ua)) return "macos";
  if (/Linux|X11/i.test(ua) && !/Android/i.test(ua)) return "linux";
  return "";
}

/** One row per operating system with a button per build the store has uploaded; "Coming soon" for a system without one. */
export default function DownloadList() {
  const [release, setRelease] = useState<Release | null | undefined>(undefined);  // undefined: loading, null: nothing published yet
  const [mine, setMine] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    setMine(detect());
    api<Detail>("GET", APP).then(
      (d) => setRelease(d.releases.find((r) => r.channel === "stable") ?? d.releases[0] ?? null),
      (e) => (/no such/i.test(e.message) ? setRelease(null) : setError(e.message)),
    );
  }, []);
  if (error) return <p className="error" role="alert">The downloads could not be loaded: {error}</p>;
  if (release === undefined) return <p>Loading…</p>;
  const systems = [...SYSTEMS].sort((a, b) => Number(b.id === mine) - Number(a.id === mine));
  return (
    <div className="downloads">
      {release && <p className="muted">Version {release.version}{release.channel !== "stable" && ` ${release.channel}`}</p>}
      {systems.map((s) => {
        const files = release ? release.file_list.filter((f) => f.uploaded && f.platform in s.builds) : [];
        return (
          <div key={s.id} className="download-row">
            <div>
              <strong>{s.label}</strong>{s.id === mine && <> <span className="tag">Your system</span></>}
              <div className="muted">{s.note}</div>
            </div>
            <div className="download-buttons">
              {release && files.length > 0 ? files.map((f) => (
                <a key={f.path} className="play-button" href={href(release.version, f.path)} download>
                  Download{files.length > 1 && ` (${s.builds[f.platform as keyof typeof s.builds]})`}
                  <small> {size(f.bytes)}</small>
                </a>
              )) : <span className="play-button" aria-disabled="true">Coming soon</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
