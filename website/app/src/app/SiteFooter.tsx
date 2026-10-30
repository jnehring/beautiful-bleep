// SPDX-License-Identifier: MIT
"use client";
import { usePathname } from "next/navigation";

const GITHUB = "https://github.com/jnehring/beautiful-bleep";
const link = (path: string, href: string) => ({ href, current: path.startsWith(href.replace(/\/$/, "")) });

/** Footer menu on every page. */
export default function SiteFooter() {
  const path = usePathname() ?? "/";
  const col = (label: string, items: [string, string][]) => (
    <nav aria-label={label}>
      <h2>{label}</h2>
      {items.map(([title, href]) => {
        const external = href.startsWith("http");
        return <a key={href} href={href} rel={external ? "noopener" : undefined}
          aria-current={!external && link(path, href).current ? "page" : undefined}>{title}</a>;
      })}
    </nav>
  );
  return (
    <footer className="site">
      <div className="footer-cols">
        {col("Explore", [["Play", "/board/"], ["Download", "/download/"], ["Bleep Library", "/library/"], ["Documentation", "/docs/musicians/overview/"], ["Blog", "/blog/"]])}
        {col("Project", [["About", "/about/"], ["Contact", "/contact/"], ["GitHub", GITHUB], ["Report an issue", `${GITHUB}/issues`]])}
        {col("Legal", [["Impressum", "/impressum/"], ["Privacy", "/privacy/"]])}
      </div>
      <p>Beautiful Bleep is free and open source (GPL, with a module exception).</p>
    </footer>
  );
}
