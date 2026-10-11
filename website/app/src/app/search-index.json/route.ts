// SPDX-License-Identifier: MIT
// The full-text search index: one entry per doc page, generated at build time
// (static export) and fetched once by the header search box.
import { allDocs } from "@/lib/content";

export const dynamic = "force-static";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };

/** Markup → plain text; code stays, tags and entities go. */
function plain(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

export function GET() {
  const entries = allDocs().map((d) => ({
    url: `/docs/${d.slug.join("/")}/`,
    title: d.title,
    audience: d.audience,
    text: plain(d.html),
  }));
  return Response.json(entries);
}
