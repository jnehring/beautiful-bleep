// SPDX-License-Identifier: MIT
"use client";
import { useEffect } from "react";

/** Old URLs (module reference, instruments, effects) now live in the Bleep Library. */
export function Redirect({ to }: { to: string }) {
  useEffect(() => { window.location.replace(to); }, [to]);
  return <p><a href={to}>Moved to the Bleep Library →</a></p>;
}
