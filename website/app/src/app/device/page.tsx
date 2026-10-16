// SPDX-License-Identifier: MIT
"use client";
import { useEffect, useState } from "react";
import { api, useUser } from "@/lib/auth";

type Info = { client_name: string; requested_from: string; requested_agent: string; requested_seconds_ago: number };

/** Where the user confirms the code the app or plugin shows (docs: store.md, "Login in the app"). */
export default function DevicePage() {
  const user = useUser();
  const [code, setCode] = useState("");
  const [info, setInfo] = useState<Info | null>(null);
  const [done, setDone] = useState<"approved" | "denied" | null>(null);
  const [error, setError] = useState("");

  // The code is never taken from the address: a link someone sends you could fill it in, and you would approve a sign-in you did
  // not start. You type the code your own app shows.
  useEffect(() => {
    if (user === null) window.location.href = `/login/?next=${encodeURIComponent("/device/")}`;
  }, [user]);
  if (!user) return <p>Loading…</p>;

  const look = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      setInfo(await api<Info>("GET", `/auth/device/${encodeURIComponent(code.trim())}`));
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
      {!done && info === null && (
        <form onSubmit={look}>
          <p>Enter the code your Bleep app or plugin shows.</p>
          <label>Code<input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABCD-EFGH" autoComplete="off" maxLength={9} required /></label>
          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit">Continue</button>
        </form>
      )}
      {!done && info !== null && (
        <div>
          <p className="error" role="alert"><strong>Only continue if you just started this sign-in yourself, in a Bleep app on your own computer.</strong>{" "}
            Someone else can start one too and ask you to approve it: they would then act as <strong>{user.display_name}</strong>.</p>
          <p>The app calls itself <q>{info.client_name}</q> (it chose that name; it is not checked) and asks to act as <strong>{user.display_name}</strong>: share presets,
            comment and rate in the Bleep Store. It cannot change your account or password.</p>
          <ul>
            <li>Started from address <code>{info.requested_from || "unknown"}</code>, {info.requested_seconds_ago < 90 ? `${info.requested_seconds_ago} seconds` : `${Math.round(info.requested_seconds_ago / 60)} minutes`} ago.</li>
            {info.requested_agent && <li>Program: <code>{info.requested_agent}</code></li>}
            <li>Code: <code>{code.trim().toUpperCase()}</code>. It must be the one your app shows.</li>
          </ul>
          <p className="muted">Is that your own network? If you do not know the address or did not just start this, refuse.</p>
          {error && <p className="error" role="alert">{error}</p>}
          <p><button type="button" onClick={() => answer(false)}>Refuse</button> <button type="button" onClick={() => answer(true)}>Allow</button></p>
        </div>
      )}
    </div>
  );
}
