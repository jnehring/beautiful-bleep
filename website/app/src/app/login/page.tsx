// SPDX-License-Identifier: MIT
"use client";
import { useState } from "react";
import { api, ApiError } from "@/lib/auth";

export default function LoginPage() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [unverified, setUnverified] = useState("");  // the address that still needs its confirmation mail
  const [note, setNote] = useState("");
  const resend = async () => {
    setNote("");
    try {
      await api("POST", "/auth/resend-verification", { email: unverified });
      setNote("If that address needs confirming, a new link is on its way. Check your inbox.");
    } catch (err) {
      setNote((err as Error).message);
    }
  };
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError(""); setUnverified(""); setNote("");
    try {
      await api("POST", "/auth/login", { email: f.get("email"), password: f.get("password") });
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = next && /^\/(?!\/)/.test(next) ? next : "/account/";  // only a path on this site
    } catch (err) {
      if (err instanceof ApiError && err.code === "email_not_verified") setUnverified(String(f.get("email")));
      setError((err as Error).message); setBusy(false);
    }
  };
  return (
    <form className="auth" onSubmit={submit}>
      <h1>Log in</h1>
      <label>Email<input name="email" type="email" autoComplete="email" required /></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
      {error && <p className="error" role="alert">{error}</p>}
      {unverified && (
        <p>
          <button type="button" className="linklike" onClick={resend}>Resend the confirmation mail</button>
          {note && <span className="ok" role="status"> {note}</span>}
        </p>
      )}
      <button type="submit" disabled={busy}>Log in</button>
      <p><a href="/forgot-password/">Forgot your password?</a></p>
      <p>No account yet? <a href="/register/">Register</a></p>
    </form>
  );
}
