// SPDX-License-Identifier: MIT
"use client";
import { useState } from "react";
import { api } from "@/lib/auth";

export default function ContactPage() {
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError("");
    try {
      await api("POST", "/contact", { name: f.get("name"), email: f.get("email"), message: f.get("message"), website: f.get("website") });
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  };
  return (
    <form className="auth" onSubmit={submit}>
      <h1>Contact</h1>
      {sent ? (
        <p className="ok" role="status">Thank you, your message is on its way. We will answer to the address you gave.</p>
      ) : (<>
        <p>Feedback, questions or ideas? Send us a message.</p>
        <label>Name<input name="name" autoComplete="name" maxLength={100} required /></label>
        <label>Email<input name="email" type="email" autoComplete="email" required /></label>
        <label>Message<textarea name="message" rows={7} minLength={10} maxLength={5000} required /></label>
        <label className="hp" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" disabled={busy}>Send</button>
      </>)}
    </form>
  );
}
