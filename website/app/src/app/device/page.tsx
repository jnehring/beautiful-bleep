// SPDX-License-Identifier: MIT
"use client";
import { useEffect, useState } from "react";
import { api, useUser } from "@/lib/auth";

/** Where the user confirms the code the app or plugin shows (docs: store.md, "Login in the app"). */
export default function DevicePage() {
  const user = useUser();
  const [code, setCode] = useState("");
  const [client, setClient] = useState<string | null>(null);
  const [done, setDone] = useState<"approved" | "denied" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("code");
    if (c) setCode(c);
  }, []);
  useEffect(() => {
    if (user === null) window.location.href = `/login/?next=${encodeURIComponent("/device/" + window.location.search)}`;
  }, [user]);
  if (!user) return <p>Loading…</p>;

  const look = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      setClient((await api<{ client_name: string }>("GET", `/auth/device/${encodeURIComponent(code.trim())}`)).client_name);
    } catch (err) { setError((err as Error).message); }
  };
  const answer = async (approve: boolean) => {
    setError("");
    try {
      await api("POST", "/auth/device/approve", { user_code: code.trim(), approve });
      setDone(approve ? "approved" : "denied");
    } catch (err) { setError((err as Error).message); }
  };

  return (
    <div className="auth">
      <h1>Sign in to Bleep</h1>
      {done === "approved" && <p className="ok" role="status">Done. You can go back to the app: it is signed in as {user.display_name}.</p>}
      {done === "denied" && <p role="status">Refused. The app stays signed out.</p>}
      {!done && client === null && (
        <form onSubmit={look}>
          <p>Enter the code your Bleep app or plugin shows.</p>
          <label>Code<input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABCD-EFGH" autoComplete="off" maxLength={9} required /></label>
          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit">Continue</button>
        </form>
      )}
      {!done && client !== null && (
        <div>
          <p><strong>{client || "Bleep"}</strong> asks to act as <strong>{user.display_name}</strong>: share presets, comment and rate in the Bleep Store.
            It cannot change your account or password.</p>
          <p className="muted">Only continue if you started this sign-in yourself and the code matches: <code>{code.trim().toUpperCase()}</code></p>
          {error && <p className="error" role="alert">{error}</p>}
          <p><button type="button" onClick={() => answer(true)}>Allow</button> <button type="button" onClick={() => answer(false)}>Refuse</button></p>
        </div>
      )}
    </div>
  );
}
