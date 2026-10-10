// SPDX-License-Identifier: MIT
"use client";
import { useEffect } from "react";

/** /admin/ has no content of its own; the page lives at /admin/tokens/. */
export default function AdminIndex() {
  useEffect(() => { window.location.replace("/admin/tokens/"); }, []);
  return <p>Loading…</p>;
}
