// SPDX-License-Identifier: MIT
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms of use — Beautiful Bleep" };

// TODO(owner): have the text checked before going live.
export default function TermsPage() {
  return (
    <>
      <h1>Terms of use</h1>
      <p>Beautiful Bleep is a free, very fresh project. It is provided as is, without warranty, and may change or go away.</p>
      <h2>Using the site</h2>
      <p>Playing, downloading and reading the documentation is free. Please do not abuse the service or try to break it.</p>
      <h2>Your account</h2>
      <p>Keep your password safe. You are responsible for what happens under your account. We may block accounts that break these terms.</p>
      <h2>Content you publish</h2>
      <p>
        When you publish presets or modules in the Bleep Library, you confirm that you made them (audio files attached to a
        preset included) or have the right to share them, and that the licence you declare is correct. You keep your rights. Presets are shared under CC BY 4.0,
        which lets everyone who downloads one copy and change it if they credit you; a module declares its own licence. Do not upload anything illegal, harmful or infringing. We may remove
        content that breaks these rules.
      </p>
      <h2>Liability</h2>
      <p>
        We are liable without limit for intent, gross negligence and injury to life, body or health, and as the law
        requires otherwise. Beyond that, liability is limited to foreseeable damage typical for the contract.
      </p>
      <h2>Source code</h2>
      <p>The software is MIT licensed; see <a href="https://github.com/jnehring/beautiful-bleep" rel="noopener">GitHub</a>.</p>
    </>
  );
}
