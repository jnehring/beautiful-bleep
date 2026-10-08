// SPDX-License-Identifier: MIT
"use client";
import { usePathname } from "next/navigation";
import { AUDIENCES, audienceOf, isActive, type Audience } from "@/lib/audiences";

/** Main menu (Musicians, Developers) and, below it, the current audience's submenu. */
export default function SiteNav() {
  const path = usePathname() ?? "/";
  const current = audienceOf(path);
  return (
    <>
      <header className="site">
        <a className="brand" href="/">Bleep Patch</a>
        <nav aria-label="Main">
          {(Object.keys(AUDIENCES) as Audience[]).map((a) => (
            <a key={a} href={AUDIENCES[a].home} aria-current={a === current ? "true" : undefined}>{AUDIENCES[a].title}</a>
          ))}
        </nav>
      </header>
      {current && (
        <nav className="submenu" aria-label={`${AUDIENCES[current].title} menu`}>
          {AUDIENCES[current].menu.map((item) => (
            <a key={item.href} href={item.href} aria-current={isActive(path, item) ? "page" : undefined}>{item.title}</a>
          ))}
        </nav>
      )}
    </>
  );
}
