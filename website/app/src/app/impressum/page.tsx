// SPDX-License-Identifier: MIT
import type { Metadata } from "next";
import ObfuscatedEmail from "../ObfuscatedEmail";

export const metadata: Metadata = { title: "Impressum — Beautiful Bleep" };

export default function ImpressumPage() {
  return (
    <>
      <h1>Impressum</h1>
      <p>Legal notice according to § 5 DDG.</p>
      <h2>Provider</h2>
      <p>
        Jan Nehring<br />
        Mahlower Straße 32<br />
        12049 Berlin<br />
        Germany
      </p>
      <h2>Contact</h2>
      <p>Email: <ObfuscatedEmail /><br />Or use the <a href="/contact/">contact form</a>.</p>
      <h2>Responsible for content (§ 18 Abs. 2 MStV)</h2>
      <p>Jan Nehring, Mahlower Straße 32, 12049 Berlin</p>
      <h2>Open source</h2>
      <p>The source code is on <a href="https://github.com/jnehring/beautiful-bleep" rel="noopener">GitHub</a> under the GPL-3.0-only licence, with a module exception. Bleep Bus is MIT.</p>
    </>
  );
}
