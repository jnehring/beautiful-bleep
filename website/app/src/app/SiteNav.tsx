// SPDX-License-Identifier: MIT
"use client";
import { usePathname } from "next/navigation";
import SearchBox from "./SearchBox";
import { api, useUser } from "@/lib/auth";
import { ACCOUNT_MENU, ADMIN_MENU, isAdminActive, isAdminPath, AUDIENCES, audienceOf, isAccountActive, isAccountPath, isActive, isModulesPath, type Audience } from "@/lib/audiences";

/** Main menu (Musicians, Developers, Modules, …) and, below it, the current audience's submenu. */
export default function SiteNav() {
  const path = usePathname() ?? "/";
  const current = audienceOf(path);
  const user = useUser();
  const logout = () => api("POST", "/auth/logout").finally(() => { window.location.href = "/"; });
  return (
    <>
      <header className="site">
        <a className="brand" href="/"><img src="/logo.svg" alt="" width={28} height={28} />Beautiful Bleep</a>
        <nav aria-label="Main">
          <a href="/board/" aria-current={path.startsWith("/board") ? "true" : undefined}>Play</a>
          {(Object.keys(AUDIENCES) as Audience[]).map((a) => (
            <a key={a} href={AUDIENCES[a].home} aria-current={a === current ? "true" : undefined}>{AUDIENCES[a].title}</a>
          ))}
          <a href="/blog/" aria-current={path.startsWith("/blog") ? "true" : undefined}>Blog</a>
          <a href="/download/" aria-current={path.startsWith("/download") ? "true" : undefined}>Download</a>
          <a href="/library/" aria-current={path.startsWith("/library") || isModulesPath(path) ? "true" : undefined}>Bleep Library</a>
        </nav>
        <nav className="account" aria-label="Account">
          {user ? (
            <>
              {user.role === "admin" && (
                <a href="/admin/tokens/" aria-current={isAdminPath(path) ? "true" : undefined}>Admin</a>
              )}
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
        <SearchBox />
      </header>
      {user && isAccountPath(path) && (
        <nav className="submenu" aria-label="Account menu">
          {ACCOUNT_MENU.map((item) => (
            <a key={item.href} href={item.href} aria-current={isAccountActive(path, item) ? "page" : undefined}>{item.title}</a>
          ))}
        </nav>
      )}
      {user?.role === "admin" && isAdminPath(path) && (
        <nav className="submenu" aria-label="Admin menu">
          {ADMIN_MENU.map((item) => (
            <a key={item.href} href={item.href} aria-current={isAdminActive(path, item) ? "page" : undefined}>{item.title}</a>
          ))}
        </nav>
      )}
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
