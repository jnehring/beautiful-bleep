// SPDX-License-Identifier: MIT
// The module's manual as an HTML fragment, for the store's detail view (static export: one file per module).
import { moduleDoc, modules } from "@/lib/content";

export const dynamic = "force-static";
export function generateStaticParams() {
  return modules().map((m) => ({ slug: m.slug }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = modules().find((x) => x.slug === slug);
  const html = m ? (moduleDoc(m)?.html ?? "") : "";
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
