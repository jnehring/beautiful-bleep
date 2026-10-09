// SPDX-License-Identifier: MIT
"use client";
import { useEffect } from "react";
import { useUser } from "@/lib/auth";

/** Admin pages: sends visitors to the login page, shows the page only to admins. */
export default function AdminGate({ title, children }: { title: string; children: React.ReactNode }) {
  const user = useUser();
  useEffect(() => {
    if (user === null) window.location.href = "/login/";
  }, [user]);
  if (!user) return <p>Loading…</p>;
  if (user.role !== "admin") return <p className="error">Admins only.</p>;
  return (
    <div className="admin">
      <h1>{title}</h1>
      {children}
    </div>
  );
}
