// SPDX-License-Identifier: MIT
import { AUDIENCES, CATEGORIES, allDocs, categoryTitle, docsFor, findDoc, modulesByCategory } from "@/lib/content";
import { notFound } from "next/navigation";

export function generateStaticParams() {
  return allDocs().map((d) => ({ slug: d.slug }));
}

const SECTION_TITLES: Record<string, string> = {
  musicians: "Start here",
  "musicians/modules": "Modules",
  "musicians/guides": "Guides",
  developers: "Start here",
  "developers/api-reference": "API reference",
};

function sectionTitle(section: string): string {
  const cat = section.match(/^musicians\/modules\/(\d+)-/);  // one section per module category
  if (cat) return `Modules · ${CATEGORIES[Number(cat[1])] ? categoryTitle(CATEGORIES[Number(cat[1])]) : "Other"}`;
  const spec = section.match(/^developers\/spec\/(.+)$/);
  return SECTION_TITLES[section] ?? (spec ? `Spec ${spec[1]}` : section);
}

// The module pages are many; the sidebar lists a category only while one of its modules is open ("All modules" links the rest).
const isModuleSection = (section: string) => /^musicians\/modules\//.test(section);

export default async function DocPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const doc = findDoc(slug);
  if (!doc) notFound();
  const audience = AUDIENCES[doc.audience];
  // Only this audience's docs: the musician and developer documentation stay separate.
  const sections = new Map<string, ReturnType<typeof allDocs>>();
  for (const d of docsFor(doc.audience)) {
    if (!sections.has(d.section)) sections.set(d.section, []);
    sections.get(d.section)!.push(d);
  }
  return (
    <div className="docs">
      <nav aria-label={`${audience.title} documentation`}>
        {[...sections.entries()].filter(([section]) => !isModuleSection(section) || section === doc.section).map(([section, docs]) => (
          <div key={section}>
            <h4>{sectionTitle(section)}</h4>
            <ul>
              {docs.map((d) => (
                <li key={d.slug.join("/")}>
                  <a href={`/docs/${d.slug.join("/")}/`} aria-current={d === doc ? "page" : undefined}>{d.title}</a>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {doc.audience === "musicians" && (
          <>
            <h4>Modules</h4>
            <ul><li><a href="/modules/">All modules</a></li></ul>
          </>
        )}
        <h4>Single files</h4>
        <ul>
          {[...audience.bundles, ...(doc.audience === "musicians" ? modulesByCategory().map((g) => `modules-${g.slug}-full.md`) : [])].map((b) => (
            <li key={b}><a href={`/docs/${b}`}>{b}</a></li>
          ))}
        </ul>
      </nav>
      <article dangerouslySetInnerHTML={{ __html: doc.html }} />
    </div>
  );
}
