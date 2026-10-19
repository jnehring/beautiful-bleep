// SPDX-License-Identifier: MIT
// The two documentations and their menus. No Node imports: the header reads
// this in the browser. They never share a sidebar or link into each other.

export type MenuItem = { title: string; href: string; match: string[] };

export const AUDIENCES = {
  musicians: {
    title: "Musicians",
    home: "/docs/musicians/overview/",
    match: ["/docs/musicians/"],
    bundles: ["user-docs-full.md"],
    menu: [
      { title: "Overview", href: "/docs/musicians/overview/", match: ["/docs/musicians/overview/"] },
      { title: "Start", href: "/docs/musicians/start/ways-to-use/", match: ["/docs/musicians/start/"] },
      { title: "Learn", href: "/docs/musicians/learn/first-patch/", match: ["/docs/musicians/learn/"] },
      { title: "Use", href: "/docs/musicians/use/board/", match: ["/docs/musicians/use/"] },
      { title: "Connect", href: "/docs/musicians/connect/connecting/", match: ["/docs/musicians/connect/"] },
      { title: "Reference", href: "/docs/musicians/reference/glossary/", match: ["/docs/musicians/reference/"] },
    ],
  },
  developers: {
    title: "Developers",
    home: "/docs/developers/overview/",
    match: ["/docs/developers/"],
    bundles: ["developer-overview-full.md", "quickstart-full.md", "api-reference-full.md", "spec-v0.1-full.md",
      "developer-bus-full.md", "developer-assistant-full.md", "developer-development-full.md", "developer-modules-full.md",
      "developer-plugins-full.md", "developer-app-full.md", "developer-web-full.md", "developer-script-full.md",
      "developer-setup-full.md", "llms.txt"],
    // Each item is a part of the documentation with its own overview page and its own sidebar menu: the sidebar lists
    // only the sections whose pages match the item the visitor is in (see sectionsOf below).
    menu: [
      { title: "Overview", href: "/docs/developers/overview/", match: ["/docs/developers/overview/"] },
      { title: "Bleep Bus", href: "/docs/developers/bleep-bus/overview/",
        match: ["/docs/developers/bleep-bus/", "/docs/developers/api-reference/", "/docs/developers/spec/"] },
      { title: "Bleep Assistant", href: "/docs/developers/bleep-assistant/overview/", match: ["/docs/developers/bleep-assistant/"] },
      { title: "Development", href: "/docs/developers/development/overview/",
        match: ["/docs/developers/development/", "/docs/developers/plugins/", "/docs/developers/app/", "/docs/developers/web/", "/docs/developers/modules/"] },
      { title: "Bleep Script", href: "/docs/developers/bleep-script/overview/", match: ["/docs/developers/bleep-script/"] },
      { title: "Setup and release", href: "/docs/developers/setup/overview/", match: ["/docs/developers/setup/"] },
    ],
  },
} satisfies Record<string, { title: string; home: string; match: string[]; bundles: string[]; menu: MenuItem[] }>;

/** The sidebar sections (a section is a folder under website/content), in display order. The module manuals'
 *  category sections and the spec versions are not listed: they follow these, see sectionRank(). */
export const SECTIONS: Record<string, string> = {
  musicians: "Overview",
  "musicians/start": "Start",
  "musicians/learn": "Learn",
  "musicians/use": "Use",
  "musicians/connect": "Connect",
  "musicians/reference": "Reference",
  developers: "Overview",
  "developers/bleep-bus": "Bleep Bus",
  "developers/api-reference": "Bleep Bus: API reference",
  "developers/spec": "Bleep Bus: specification",
  "developers/bleep-assistant": "Bleep Assistant",
  "developers/development": "Development",
  "developers/plugins": "Plugins",
  "developers/app": "Standalone app",
  "developers/web": "Web",
  "developers/modules": "Modules",
  "developers/bleep-script": "Bleep Script",
  "developers/setup": "Setup and release",
};
const SECTION_KEYS = Object.keys(SECTIONS);
/** Position of a section in the sidebar; the spec versions sit with the spec, everything else (module categories) last. */
export function sectionRank(section: string): number {
  const i = SECTION_KEYS.findIndex((k) => section === k || (k === "developers/spec" && section.startsWith(k + "/")));
  return i < 0 ? SECTION_KEYS.length : i;
}
export type Audience = keyof typeof AUDIENCES;

const matches = (path: string, prefixes: string[]) => prefixes.some((p) => path.startsWith(p));

/** The module reference is its own top-level menu item, not part of the musicians' docs menu. */
export const MODULES_MATCH = ["/modules/", "/docs/musicians/modules/"];
export const isModulesPath = (path: string) => matches(path, MODULES_MATCH);

export function audienceOf(path: string): Audience | undefined {
  if (isModulesPath(path)) return undefined;
  return (Object.keys(AUDIENCES) as Audience[]).find((a) => matches(path, AUDIENCES[a].match));
}

/** Whether a doc page belongs to the sidebar menu of the menu item the visitor is in (the musicians' docs have one menu). */
export function sharesMenu(audience: Audience, current: string, other: string): boolean {
  const menu: MenuItem[] = AUDIENCES[audience].menu;
  if (audience === "musicians") return true;
  const item = menu.find((m) => isActive(current, m));
  return !item || isActive(other, item);
}

export function isActive(path: string, item: MenuItem): boolean {
  return matches(path, item.match);
}

/** The submenu of the account pages (the link with the user's name in the header). */
export const ACCOUNT_MENU: MenuItem[] = [
  { title: "Overview", href: "/account/", match: ["/account/"] },
  { title: "Presets", href: "/account/presets/", match: ["/account/presets/"] },
  { title: "Apps & devices", href: "/account/apps/", match: ["/account/apps/"] },
  { title: "Settings", href: "/account/settings/", match: ["/account/settings/"] },
];
/** The submenu of the admin pages (the Admin link in the header, shown to admins only). */
export const ADMIN_MENU: MenuItem[] = [
  { title: "Tokens", href: "/admin/tokens/", match: ["/admin/tokens/"] },
  { title: "AI usage", href: "/admin/chat/", match: ["/admin/chat/"] },
];
export const isAdminPath = (path: string) => path.startsWith("/admin");
export const isAdminActive = (path: string, item: MenuItem) => (path.endsWith("/") ? path : path + "/").startsWith(item.href);

export const isAccountPath = (path: string) => path.startsWith("/account");

/** Overview matches only its own page: the others start with the same prefix. */
export function isAccountActive(path: string, item: MenuItem): boolean {
  const p = path.endsWith("/") ? path : path + "/";
  return item.href === "/account/" ? p === "/account/" : p.startsWith(item.href);
}
