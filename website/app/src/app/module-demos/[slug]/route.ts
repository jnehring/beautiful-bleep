// SPDX-License-Identifier: MIT
// A module's demo patches and presets as JSON, for the library's detail view (static export: one file per module).
import { moduleDemos, modulePresets, modules } from "@/lib/content";

export const dynamic = "force-static";
export function generateStaticParams() {
  return modules().map((m) => ({ slug: m.slug }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const known = modules().some((x) => x.slug === slug);
  return Response.json({ demos: known ? moduleDemos(slug) : [], presets: known ? modulePresets(slug) : [] });
}
