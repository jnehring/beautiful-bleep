// SPDX-License-Identifier: MIT
import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Bleep Patch — modular inside Ableton Live",
  description: "Small modular-style plugins connected by Bleep Bus, an open protocol for plugin-to-plugin modulation.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site">
          <a className="brand" href="/">Bleep Patch</a>
          <nav>
            <a href="/modules/">Modules</a>
            <a href="/docs/users/getting-started/">Getting started</a>
            <a href="/docs/developers/quickstart/">Developers</a>
            <a href="/docs/spec/v0.1/00-overview/">Spec</a>
            <a href="/llms.txt">llms.txt</a>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
