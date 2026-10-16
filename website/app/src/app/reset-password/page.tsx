// SPDX-License-Identifier: MIT
"use client";
import { useState } from "react";
import { api } from "@/lib/auth";

export default function ResetPasswordPage() {
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    setBusy(true); setError("");
    try {
      await api("POST", "/auth/reset-password", { token, new_password: f.get("new_password") });
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  };
  return (
    <form className="auth" onSubmit={submit}>
      <h1>Choose a new password</h1>
      {done ? (
        <p className="ok" role="status">Your password was changed. <a href="/login/">Log in</a></p>
      ) : (<>
        <label>New password <small>(at least 10 characters)</small>
          <input name="new_password" type="password" minLength={10} maxLength={128} autoComplete="new-password" required />
        </label>
        {error && <p className="error" role="alert">{error} <a href="/forgot-password/">Get a new link</a></p>}
        <button type="submit" disabled={busy}>Change password</button>
      </>)}
    </form>
  );
}
