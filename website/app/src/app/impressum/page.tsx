// SPDX-License-Identifier: MIT
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Impressum — Beautiful Bleep" };

// TODO(owner): replace every [bracketed] value before going live.
export default function ImpressumPage() {
  return (
    <>
      <h1>Impressum</h1>
      <p>Legal notice according to § 5 DDG.</p>
      <h2>Provider</h2>
      <p>
        [Full name]<br />
        [Street and number]<br />
        [Postcode and city]<br />
        Germany
      </p>
      <h2>Contact</h2>
      <p>Email: [email address]<br />Or use the <a href="/contact/">contact form</a>.</p>
      <h2>Responsible for content (§ 18 Abs. 2 MStV)</h2>
      <p>[Full name, same address as above]</p>
      <h2>Open source</h2>
      <p>The source code is on <a href="https://github.com/jnehring/beautiful-bleep" rel="noopener">GitHub</a> under the MIT licence.</p>
    </>
  );
}
