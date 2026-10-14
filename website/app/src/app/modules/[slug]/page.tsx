// SPDX-License-Identifier: MIT
import { modules } from "@/lib/content";
import { notFound } from "next/navigation";
import { Redirect } from "../../Redirect";

export function generateStaticParams() {
  return modules().map((m) => ({ slug: m.slug }));
}

/** Old module page: the documentation is shown in the module's Bleep Store entry. */
export default async function ModulePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!modules().some((x) => x.slug === slug)) notFound();
  return <Redirect to={`/store/detail/?kind=module&slug=${encodeURIComponent(slug)}`} />;
}
