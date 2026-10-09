// SPDX-License-Identifier: MIT
"use client";
import { usePathname } from "next/navigation";
import { api, useUser } from "@/lib/auth";
import { AUDIENCES, audienceOf, isActive, type Audience } from "@/lib/audiences";

/** Main menu (Musicians, Developers) and, below it, the current audience's submenu. */
export default function SiteNav() {
  const path = usePathname() ?? "/";
  const current = audienceOf(path);
  const user = useUser();
  const logout = () => api("POST", "/auth/logout").finally(() => { window.location.href = "/"; });
  return (
    <>
      <header className="site">
        <a className="brand" href="/">Bleep Patch</a>
        <nav aria-label="Main">
          {(Object.keys(AUDIENCES) as Audience[]).map((a) => (
            <a key={a} href={AUDIENCES[a].home} aria-current={a === current ? "true" : undefined}>{AUDIENCES[a].title}</a>
          ))}
          <a href="/board/" aria-current={path.startsWith("/board") ? "true" : undefined}>Bleep Board</a>
        </nav>
        <nav className="account" aria-label="Account">
          {user ? (
            <>
              <a href="/account/" aria-current={path.startsWith("/account") ? "true" : undefined}>{user.display_name}</a>
              <button type="button" className="linklike" onClick={logout}>Log out</button>
            </>
          ) : user === null ? (
            <>
              <a href="/login/" aria-current={path.startsWith("/login") ? "true" : undefined}>Log in</a>
              <a href="/register/" aria-current={path.startsWith("/register") ? "true" : undefined}>Register</a>
            </>
          ) : null}
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
