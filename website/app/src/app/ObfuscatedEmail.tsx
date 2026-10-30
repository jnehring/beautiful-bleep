// SPDX-License-Identifier: MIT
"use client";
import { useEffect, useState } from "react";

// The address is stored reversed and base64-encoded, and only assembled in the
// browser, so it never appears in the static HTML that spam crawlers read.
const ENCODED = "bW9jLmtvb2x0dW9AZ25pcmhlbm5hag==";

/** Email link that is decoded client-side to keep the address away from scrapers. */
export default function ObfuscatedEmail() {
  const [address, setAddress] = useState<string | null>(null);
  useEffect(() => setAddress(atob(ENCODED).split("").reverse().join("")), []);
  if (!address) return <span>[enable JavaScript to see the address]</span>;
  return <a href={`mailto:${address}`}>{address}</a>;
}
