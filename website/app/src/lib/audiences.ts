// SPDX-License-Identifier: MIT
// The two documentations and their menus. No Node imports: the header reads
// this in the browser. They never share a sidebar or link into each other.

export type MenuItem = { title: string; href: string; match: string[] };

export const AUDIENCES = {
  musicians: {
    title: "Musicians",
    home: "/docs/musicians/getting-started/",
    match: ["/docs/musicians/"],
    bundles: ["user-docs-full.md"],
    menu: [
      { title: "Ways to use Bleep", href: "/docs/musicians/overview/", match: ["/docs/musicians/overview/"] },
      { title: "Getting started", href: "/docs/musicians/getting-started/", match: ["/docs/musicians/getting-started/"] },
      { title: "Glossary", href: "/docs/musicians/glossary/", match: ["/docs/musicians/glossary/"] },
      { title: "Guides", href: "/docs/musicians/guides/midi-out-routing/", match: ["/docs/musicians/guides/"] },
    ],
  },
  developers: {
    title: "Developers",
    home: "/docs/developers/overview/",
    match: ["/docs/developers/"],
    bundles: ["developer-overview-full.md", "quickstart-full.md", "api-reference-full.md", "spec-v0.1-full.md",
      "developer-modules-full.md", "developer-plugins-full.md", "developer-app-full.md", "developer-web-full.md",
      "developer-reference-full.md", "llms.txt"],
    menu: [
      { title: "Overview", href: "/docs/developers/overview/", match: ["/docs/developers/overview/"] },
      { title: "Bleep Bus", href: "/docs/developers/quickstart/",
        match: ["/docs/developers/quickstart/", "/docs/developers/api-reference/", "/docs/developers/spec/", "/docs/developers/conformance/", "/docs/developers/rfc-process/"] },
      { title: "Modules", href: "/docs/developers/modules/01-overview/", match: ["/docs/developers/modules/"] },
      { title: "Plugins", href: "/docs/developers/plugins/01-overview/", match: ["/docs/developers/plugins/"] },
      { title: "Standalone app", href: "/docs/developers/app/01-standalone-app/", match: ["/docs/developers/app/"] },
      { title: "Web", href: "/docs/developers/web/01-bleep-play/", match: ["/docs/developers/web/"] },
      { title: "Reference", href: "/docs/developers/reference/module-abi/", match: ["/docs/developers/reference/"] },
    ],
  },
} satisfies Record<string, { title: string; home: string; match: string[]; bundles: string[]; menu: MenuItem[] }>;
export type Audience = keyof typeof AUDIENCES;

const matches = (path: string, prefixes: string[]) => prefixes.some((p) => path.startsWith(p));

/** The module reference is its own top-level menu item, not part of the musicians' docs menu. */
export const MODULES_MATCH = ["/modules/", "/docs/musicians/modules/"];
export const isModulesPath = (path: string) => matches(path, MODULES_MATCH);

export function audienceOf(path: string): Audience | undefined {
  if (isModulesPath(path)) return undefined;
  return (Object.keys(AUDIENCES) as Audience[]).find((a) => matches(path, AUDIENCES[a].match));
}

export function isActive(path: string, item: MenuItem): boolean {
  return matches(path, item.match);
}
