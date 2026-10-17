// SPDX-License-Identifier: MIT
"use client";
import { useEffect, useState } from "react";
import { api, useAccountUser } from "@/lib/auth";

type Preset = { state: string };
type Token = { id: number };

export default function AccountPage() {
  const user = useAccountUser();
  const [presets, setPresets] = useState<Preset[] | null>(null);
  const [apps, setApps] = useState<Token[] | null>(null);
  useEffect(() => {
    if (!user) return;
    api<Preset[]>("GET", "/presets/mine").then(setPresets, () => setPresets(null));
    api<Token[]>("GET", "/tokens").then(setApps, () => setApps(null));
  }, [user]);
  if (!user) return <p>Loading…</p>;
  const listed = presets?.filter((p) => p.state === "listed").length ?? 0;
  return (
    <div className="auth">
      <h1>{user.display_name}</h1>
      <p className="muted">{user.email} · {user.role === "admin" ? "Admin" : "User"} · member since {user.created_at.slice(0, 10)}</p>
      {!user.email_verified && <p className="error" role="status">Your email address is not confirmed yet. <a href="/account/settings/">Settings</a></p>}
      {user.bio && <p>{user.bio}</p>}
      <ul>
        <li><a href="/account/presets/">Presets</a>{presets && <small className="muted"> · {presets.length} shared{presets.length > listed ? `, ${listed} listed` : ""}</small>}</li>
        <li><a href="/account/apps/">Apps &amp; devices</a>{apps && <small className="muted"> · {apps.length} signed in</small>}</li>
        <li><a href="/account/settings/">Settings</a><small className="muted"> · name, about you, password</small></li>
      </ul>
    </div>
  );
}
