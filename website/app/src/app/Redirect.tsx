// SPDX-License-Identifier: MIT
"use client";
import { useEffect } from "react";

/** Old module-reference URLs now live in the Bleep Store. */
export function Redirect({ to }: { to: string }) {
  useEffect(() => { window.location.replace(to); }, [to]);
  return <p><a href={to}>Moved to the Bleep Store →</a></p>;
}
