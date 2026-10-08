// SPDX-License-Identifier: MIT
import { moduleDoc, modules } from "@/lib/content";
import { notFound } from "next/navigation";

export function generateStaticParams() {
  return modules().map((m) => ({ slug: m.slug }));
}

export default async function ModulePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = modules().find((x) => x.slug === slug);
  if (!m) notFound();
  const doc = moduleDoc(m);
  return (
    <article style={{ borderTop: `4px solid ${m.colour}`, paddingTop: 8 }}>
      <p className="tag">{m.formats.join(" · ")} · free and open source (MIT)</p>
      {doc ? <div dangerouslySetInnerHTML={{ __html: doc.html }} /> : <h1>{m.name}</h1>}
    </article>
  );
}
