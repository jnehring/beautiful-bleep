// SPDX-License-Identifier: MIT
"use client";
import { useState } from "react";
import { api } from "@/lib/auth";

export default function ForgotPasswordPage() {
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError("");
    try {
      await api("POST", "/auth/forgot-password", { email: f.get("email") });
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  };
  return (
    <form className="auth" onSubmit={submit}>
      <h1>Forgot your password?</h1>
      {sent ? (
        <p className="ok" role="status">If an account exists for that address, we sent a link to choose a new password. It works for an hour.</p>
      ) : (<>
        <p>Enter your email address and we will send you a link to choose a new password.</p>
        <label>Email<input name="email" type="email" autoComplete="email" required /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" disabled={busy}>Send link</button>
      </>)}
      <p><a href="/login/">Back to log in</a></p>
    </form>
  );
}
