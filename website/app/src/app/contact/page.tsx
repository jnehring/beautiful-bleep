// SPDX-License-Identifier: MIT
import type { Metadata } from "next";
import ObfuscatedEmail from "../ObfuscatedEmail";

export const metadata: Metadata = { title: "Contact — Beautiful Bleep" };

export default function ContactPage() {
  return (
    <>
      <h1>Contact</h1>
      <p>Feedback, questions or ideas? Send me an email at <ObfuscatedEmail />.</p>
      <p>
        Bugs and feature requests can also go to the{" "}
        <a href="https://github.com/jnehring/beautiful-bleep/issues" rel="noopener">issues on GitHub</a>.
      </p>
    </>
  );
}
