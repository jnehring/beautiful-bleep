// SPDX-License-Identifier: MIT
"use client";
import { useEffect } from "react";

/** /admin/ has no content of its own; the two pages live at /admin/downloads/ and /admin/tokens/. */
export default function AdminIndex() {
  useEffect(() => { window.location.replace("/admin/downloads/"); }, []);
  return <p>Loading…</p>;
}
