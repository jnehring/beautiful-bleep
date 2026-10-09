// SPDX-License-Identifier: MIT
"use client";
import { useState } from "react";
import { api } from "@/lib/auth";

export default function LoginPage() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError("");
    try {
      await api("POST", "/auth/login", { email: f.get("email"), password: f.get("password") });
      window.location.href = "/account/";
    } catch (err) {
      setError((err as Error).message); setBusy(false);
    }
  };
  return (
    <form className="auth" onSubmit={submit}>
      <h1>Log in</h1>
      <label>Email<input name="email" type="email" autoComplete="email" required /></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" disabled={busy}>Log in</button>
      <p>No account yet? <a href="/register/">Register</a></p>
    </form>
  );
}
