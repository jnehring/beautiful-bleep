// SPDX-License-Identifier: MIT
"use client";
import { useEffect, useState } from "react";

export type User = {
  id: number; email: string; display_name: string; bio: string;
  role: "admin" | "user"; is_active: boolean; email_verified: boolean; created_at: string;
};

/** An API failure: `message` is the server's text, `code` its machine-readable marker (e.g. "email_not_verified"), if any. */
export class ApiError extends Error {
  constructor(message: string, public status: number, public code: string | null = null) { super(message); }
}

/** JSON call to the API. Throws Error(message) with the server's message on failure. */
export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(errorMessage(data) ?? `Request failed (${res.status})`, res.status, errorCode(data));
  return data as T;
}

function errorCode(data: any): string | null {
  const c = data?.detail?.code;
  return typeof c === "string" ? c : null;
}

const CODES: Record<string, string> = {
  patch_unavailable: "This patch is no longer available.",
  version_unavailable: "This version does not exist.",
};

function errorMessage(data: any): string | null {
  const d = data?.detail;
  if (typeof d === "string") return d;
  if (typeof d?.error === "string" && CODES[d.error]) return CODES[d.error];
  if (typeof d?.message === "string") return d.message;
  if (Array.isArray(d) && d[0]?.msg) return `${String(d[0].loc?.at(-1) ?? "")}: ${d[0].msg}`.replace(/^: /, "");
  return null;
}

/** undefined while loading, null when logged out. */
export function useUser(): User | null | undefined {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => {
    api<User>("GET", "/auth/me").then(setUser, () => setUser(null));
  }, []);
  return user;
}

/** The user of an account page: sends a logged-out visitor to the login page and returns null until there is a user. */
export function useAccountUser(): User | null {
  const user = useUser();
  useEffect(() => {
    if (user === null) window.location.href = `/login/?next=${encodeURIComponent(window.location.pathname)}`;
  }, [user]);
  return user ?? null;
}
