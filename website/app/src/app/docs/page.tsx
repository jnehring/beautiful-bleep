// SPDX-License-Identifier: MIT
import type { Metadata } from "next";
import { AUDIENCES } from "@/lib/audiences";

export const metadata: Metadata = { title: "Documentation — Beautiful Bleep" };

/** The Documentation item in the main menu: one door into each of the two documentations. */
export default function DocsIndexPage() {
  return (
    <>
      <h1>Documentation</h1>
      <p>Pick the documentation that fits what you want to do.</p>
      <div className="grid doors">
        <a className="card door-button" href={AUDIENCES.musicians.home}>
          <h2>For musicians</h2>
          <p>Install, make a first sound, learn to patch, and connect plugin, app and browser.</p>
        </a>
        <a className="card door-button" href={AUDIENCES.developers.home}>
          <h2>For developers</h2>
          <p>Bleep Bus, the protocol behind the cables, writing modules and plugins, Bleep Script and the assistant.</p>
        </a>
      </div>
    </>
  );
}
