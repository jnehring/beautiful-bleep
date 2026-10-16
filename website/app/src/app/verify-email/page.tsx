// SPDX-License-Identifier: MIT
"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/auth";

export default function VerifyEmailPage() {
  const [state, setState] = useState<"working" | "ok" | string>("working");
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    api("POST", "/auth/verify-email", { token }).then(() => setState("ok"), (err: Error) => setState(err.message));
  }, []);
  return (
    <div className="auth">
      <h1>Confirm your email</h1>
      {state === "working" && <p>Checking the link…</p>}
      {state === "ok" && <p className="ok" role="status">Your email address is confirmed. <a href="/account/">Go to your account</a></p>}
      {state !== "working" && state !== "ok" && <p className="error" role="alert">{state} Log in and ask for a new link on your <a href="/account/">account page</a>.</p>}
    </div>
  );
}
