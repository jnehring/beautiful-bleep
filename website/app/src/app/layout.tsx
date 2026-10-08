// SPDX-License-Identifier: MIT
import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import SiteNav from "./SiteNav";

export const metadata: Metadata = {
  title: "Bleep Patch — modular inside Ableton Live",
  description: "Small modular-style plugins connected by Bleep Bus, an open protocol for plugin-to-plugin modulation.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SiteNav />
        <main>{children}</main>
      </body>
    </html>
  );
}
