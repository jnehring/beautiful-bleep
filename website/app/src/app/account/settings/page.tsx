// SPDX-License-Identifier: MIT
"use client";
import { useState } from "react";
import { api, useAccountUser, type User } from "@/lib/auth";

type Notice = { ok: boolean; text: string } | null;

export default function SettingsPage() {
  const user = useAccountUser();
  const [profileNote, setProfileNote] = useState<Notice>(null);
  const [passwordNote, setPasswordNote] = useState<Notice>(null);
  const [verifyNote, setVerifyNote] = useState<Notice>(null);
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
  const resend = async () => {
    try {
      await api("POST", "/auth/resend-verification", { email: user.email });
      setVerifyNote({ ok: true, text: "If the address still needs confirming, a new link is on its way." });
    } catch (err) {
      setVerifyNote({ ok: false, text: (err as Error).message });
    }
  };

  return (
    <div className="auth">
      <h1>Settings</h1>
      <form onSubmit={saveProfile}>
        <label>Name<input name="display_name" defaultValue={user.display_name} maxLength={60} required /></label>
        <label>About you<textarea name="bio" defaultValue={user.bio} maxLength={2000} rows={5} /></label>
        {profileNote && <p className={profileNote.ok ? "ok" : "error"} role="status">{profileNote.text}</p>}
        <button type="submit">Save</button>
      </form>
      <h2>Email</h2>
      <p className="muted">{user.email} · {user.email_verified ? "confirmed" : "not confirmed"}</p>
      {!user.email_verified && (
        <>
          <button type="button" onClick={resend}>Send the confirmation link again</button>
          {verifyNote && <p className={verifyNote.ok ? "ok" : "error"} role="status">{verifyNote.text}</p>}
        </>
      )}
      <h2>Change password</h2>
      <form onSubmit={changePassword}>
        <label>Current password<input name="current_password" type="password" autoComplete="current-password" required /></label>
        <label>New password <small>(at least 10 characters)</small>
          <input name="new_password" type="password" minLength={10} maxLength={128} autoComplete="new-password" required />
        </label>
        {passwordNote && <p className={passwordNote.ok ? "ok" : "error"} role="status">{passwordNote.text}</p>}
        <button type="submit">Change password</button>
      </form>
    </div>
  );
}
