// SPDX-License-Identifier: MIT
"use client";
import { useState } from "react";
import { api, type User } from "@/lib/auth";

export default function RegisterPage() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState("");
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError("");
    try {
      const user = await api<User>("POST", "/auth/register", {
        display_name: f.get("display_name"), email: f.get("email"), password: f.get("password"),
      });
      if (user.email_verified) window.location.href = "/account/";  // confirmation is switched off: already logged in
      else { setSentTo(user.email); setBusy(false); }
    } catch (err) {
      setError((err as Error).message); setBusy(false);
    }
  };
  if (sentTo) {
    return (
      <div className="auth">
        <h1>Check your inbox</h1>
        <p className="ok" role="status">We sent a confirmation link to {sentTo}. Open it, then <a href="/login/">log in</a>.</p>
        <p className="muted">Nothing there? Look in your spam folder, or ask for a new link on the <a href="/login/">login page</a>.</p>
      </div>
    );
  }
  return (
    <form className="auth" onSubmit={submit}>
      <h1>Register</h1>
      <label>Name<input name="display_name" maxLength={60} autoComplete="nickname" required /></label>
      <label>Email<input name="email" type="email" autoComplete="email" required /></label>
      <label>Password <small>(at least 10 characters)</small>
        <input name="password" type="password" minLength={10} maxLength={128} autoComplete="new-password" required />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" disabled={busy}>Create account</button>
      <p>Already registered? <a href="/login/">Log in</a></p>
    </form>
  );
}
