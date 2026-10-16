// SPDX-License-Identifier: MIT
"use client";
import { useEffect, useState } from "react";
import { api, useUser, type User } from "@/lib/auth";

type Token = { id: number; name: string; prefix: string; created_at: string; last_used_at: string | null };
type Notice = { ok: boolean; text: string } | null;

export default function AccountPage() {
  const user = useUser();
  const [profileNote, setProfileNote] = useState<Notice>(null);
  const [passwordNote, setPasswordNote] = useState<Notice>(null);
  const [tokens, setTokens] = useState<Token[]>([]);
  useEffect(() => { if (user) api<Token[]>("GET", "/tokens").then(setTokens, () => setTokens([])); }, [user]);

  useEffect(() => {
    if (user === null) window.location.href = "/login/";
  }, [user]);
  if (!user) return <p>Loading…</p>;

  const saveProfile = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await api<User>("PATCH", "/me", { display_name: f.get("display_name"), bio: f.get("bio") });
      setProfileNote({ ok: true, text: "Saved." });
    } catch (err) {
      setProfileNote({ ok: false, text: (err as Error).message });
    }
  };
  const changePassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    try {
      await api("POST", "/me/password", { current_password: f.get("current_password"), new_password: f.get("new_password") });
      form.reset();
      setPasswordNote({ ok: true, text: "Password changed. Other devices were logged out and your access tokens were revoked." });
    } catch (err) {
      setPasswordNote({ ok: false, text: (err as Error).message });
    }
  };

  return (
    <div className="auth">
      <h1>Your profile</h1>
      <form onSubmit={saveProfile}>
        <p className="muted">{user.email} · {user.role === "admin" ? "Admin" : "User"}</p>
        <label>Name<input name="display_name" defaultValue={user.display_name} maxLength={60} required /></label>
        <label>About you<textarea name="bio" defaultValue={user.bio} maxLength={2000} rows={5} /></label>
        {profileNote && <p className={profileNote.ok ? "ok" : "error"} role="status">{profileNote.text}</p>}
        <button type="submit">Save</button>
      </form>
      <h2>Change password</h2>
      <form onSubmit={changePassword}>
        <label>Current password<input name="current_password" type="password" autoComplete="current-password" required /></label>
        <label>New password <small>(at least 10 characters)</small>
          <input name="new_password" type="password" minLength={10} maxLength={128} autoComplete="new-password" required />
        </label>
        {passwordNote && <p className={passwordNote.ok ? "ok" : "error"} role="status">{passwordNote.text}</p>}
        <button type="submit">Change password</button>
      </form>
      <h2>Signed-in apps</h2>
      <p className="muted">Apps and plugins you signed in to Bleep. Remove one to sign it out.</p>
      {tokens.length === 0 ? <p className="muted">None.</p> : (
        <ul>{tokens.map((t) => (
          <li key={t.id}>{t.name} <small className="muted">· last used {t.last_used_at ? t.last_used_at.slice(0, 10) : "never"}</small>{" "}
            <button type="button" className="linklike" onClick={async () => { await api("DELETE", `/tokens/${t.id}`); setTokens(tokens.filter((x) => x.id !== t.id)); }}>Remove</button></li>
        ))}</ul>
      )}
    </div>
  );
}
