// SPDX-License-Identifier: MIT
"use client";
import { useEffect, useState } from "react";

export type User = {
  id: number; email: string; display_name: string; bio: string;
  role: "admin" | "user"; is_active: boolean; email_verified: boolean; created_at: string;
};

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
  if (!res.ok) throw new Error(errorMessage(data) ?? `Request failed (${res.status})`);
  return data as T;
}

function errorMessage(data: any): string | null {
  const d = data?.detail;
  if (typeof d === "string") return d;
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
