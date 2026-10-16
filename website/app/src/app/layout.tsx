// SPDX-License-Identifier: MIT
import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import SiteNav from "./SiteNav";
import SiteFooter from "./SiteFooter";

export const metadata: Metadata = {
  metadataBase: new URL("https://brilliantbleep.com"),
  title: "Beautiful Bleep — a modular sound engine for plugin, app and web",
  description: "One modular engine as a plugin in Ableton Live, a standalone app and in your browser. Play a preset or patch your own.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SiteNav />
        <main>{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
