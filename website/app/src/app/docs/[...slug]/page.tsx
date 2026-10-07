// SPDX-License-Identifier: MIT
import { allDocs, findDoc } from "@/lib/content";
import { notFound } from "next/navigation";

export function generateStaticParams() {
  return allDocs().map((d) => ({ slug: d.slug }));
}

const SECTION_TITLES: Record<string, string> = {
  users: "Musicians",
  "users/modules": "Modules",
  "users/guides": "Guides",
  developers: "Developers",
  "developers/api-reference": "API reference",
};

export default async function DocPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const doc = findDoc(slug);
  if (!doc) notFound();
  const sections = new Map<string, ReturnType<typeof allDocs>>();
  for (const d of allDocs()) {
    if (!sections.has(d.section)) sections.set(d.section, []);
    sections.get(d.section)!.push(d);
  }
  return (
    <div className="docs">
      <nav aria-label="Documentation">
        {[...sections.entries()].map(([section, docs]) => (
          <div key={section}>
            <h4>{SECTION_TITLES[section] ?? (section.startsWith("spec/") ? `Spec ${section.slice(6)}` : section)}</h4>
            <ul>
              {docs.map((d) => (
                <li key={d.slug.join("/")}>
                  <a href={`/docs/${d.slug.join("/")}/`}>{d.title}</a>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <h4>Single files</h4>
        <ul>
          <li><a href="/docs/quickstart-full.md">quickstart-full.md</a></li>
          <li><a href="/docs/api-reference-full.md">api-reference-full.md</a></li>
          <li><a href="/docs/spec-v0.1-full.md">spec-v0.1-full.md</a></li>
        </ul>
      </nav>
      <article dangerouslySetInnerHTML={{ __html: doc.html }} />
    </div>
  );
}
