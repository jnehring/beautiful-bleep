// SPDX-License-Identifier: MIT
import type { Metadata } from "next";

export const metadata: Metadata = { title: "About — Beautiful Bleep" };

export default function AboutPage() {
  return (
    <>
      <h1>About</h1>
      <p>
        Beautiful Bleep is an open source project. The code is on{" "}
        <a href="https://github.com/jnehring/beautiful-bleep" rel="noopener">GitHub</a>.
      </p>
      <p>It is made by Jan from Germany, an open source developer and musician.</p>
      <h2>Free to use</h2>
      <p>Beautiful Bleep is free to use.</p>
      <h2>Feedback</h2>
      <p>
        This is a very fresh project, and we are happy for feedback. Write to us through the{" "}
        <a href="/contact/">contact form</a> or open an issue on GitHub.
      </p>
      <h2>Disclaimer</h2>
      <p>AI was heavily used to build this project.</p>
    </>
  );
}
