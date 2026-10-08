// SPDX-License-Identifier: MIT
// The two documentations and their menus. No Node imports: the header reads
// this in the browser. They never share a sidebar or link into each other.

export type MenuItem = { title: string; href: string; match: string[] };

export const AUDIENCES = {
  musicians: {
    title: "Musicians",
    home: "/docs/musicians/getting-started/",
    match: ["/docs/musicians/", "/modules/"],
    bundles: ["user-docs-full.md"],
    menu: [
      { title: "Getting started", href: "/docs/musicians/getting-started/", match: ["/docs/musicians/getting-started/"] },
      { title: "Modules", href: "/modules/", match: ["/modules/", "/docs/musicians/modules/"] },
      { title: "Guides", href: "/docs/musicians/guides/midi-out-routing/", match: ["/docs/musicians/guides/"] },
    ],
  },
  developers: {
    title: "Developers",
    home: "/docs/developers/quickstart/",
    match: ["/docs/developers/"],
    bundles: ["quickstart-full.md", "api-reference-full.md", "spec-v0.1-full.md", "llms.txt"],
    menu: [
      { title: "Quickstart", href: "/docs/developers/quickstart/", match: ["/docs/developers/quickstart/"] },
      { title: "API reference", href: "/docs/developers/api-reference/00-overview/", match: ["/docs/developers/api-reference/"] },
      { title: "Spec v0.1", href: "/docs/developers/spec/v0.1/00-overview/", match: ["/docs/developers/spec/"] },
      { title: "Conformance", href: "/docs/developers/conformance/", match: ["/docs/developers/conformance/"] },
      { title: "RFC process", href: "/docs/developers/rfc-process/", match: ["/docs/developers/rfc-process/"] },
    ],
  },
} satisfies Record<string, { title: string; home: string; match: string[]; bundles: string[]; menu: MenuItem[] }>;
export type Audience = keyof typeof AUDIENCES;

const matches = (path: string, prefixes: string[]) => prefixes.some((p) => path.startsWith(p));

export function audienceOf(path: string): Audience | undefined {
  return (Object.keys(AUDIENCES) as Audience[]).find((a) => matches(path, AUDIENCES[a].match));
}

export function isActive(path: string, item: MenuItem): boolean {
  return matches(path, item.match);
}
