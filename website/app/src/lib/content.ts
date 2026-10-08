// SPDX-License-Identifier: MIT
// Reads the docs (website/content), the module metadata and the module
// documentation (patch/modules/<name>/module.json and doc/) at build time.
// The module docs are the same files the board shows behind each view's ?
// button; they appear here as musicians/modules/<slug>. Nothing outside
// website/ depends on this.
import fs from "node:fs";
import path from "node:path";
import { marked } from "marked";
import { AUDIENCES, type Audience } from "./audiences";

export { AUDIENCES, type Audience };

const ROOT = path.resolve(process.cwd(), "..", "..");
const CONTENT = path.join(ROOT, "website", "content");
const MODULES = path.join(ROOT, "patch", "modules");

export type Doc = { slug: string[]; audience: Audience; title: string; order: number; section: string; html: string };
/** `doc` is relative to the module's folder, e.g. "doc/adsr.md". */
export type ModuleMeta = { name: string; slug: string; tagline: string; colour: string; formats: string[]; doc: string };

function parse(file: string): { meta: Record<string, string>; body: string } {
  let text = fs.readFileSync(file, "utf8");
  const meta: Record<string, string> = {};
  if (text.startsWith("---\n")) {
    const end = text.indexOf("\n---\n", 4);
    for (const line of text.slice(4, end).split("\n")) {
      const i = line.indexOf(":");
      if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    text = text.slice(end + 5);
  }
  return { meta, body: text };
}

/** Rewrites links between Markdown files to site URLs. */
function rewriteLinks(html: string, slug: string[]): string {
  return html.replace(/href="([^":#]+)\.md(#[^"]*)?"/g, (_m, target: string, hash = "") => {
    const resolved = path.posix.normalize(path.posix.join(slug.slice(0, -1).join("/"), target));
    return `href="/docs/${resolved}/${hash}"`;
  });
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith(".md") ? [path.join(dir, e.name)] : []);
}

/** Images and other files next to a module's doc are copied to /modules/<slug>/ (scripts/build-docs.py). */
function rewriteAssets(html: string, moduleSlug: string): string {
  return html.replace(/(src|href)="(?![a-z]+:|\/|#)([^"]+\.(?:png|jpe?g|gif|svg|webp))"/gi,
    (_m, attr: string, file: string) => `${attr}="/modules/${moduleSlug}/${file}"`);
}

function moduleDocs(): Doc[] {
  return modules()
    .filter((m) => m.doc && fs.existsSync(path.join(MODULES, m.slug, m.doc)))
    .map((m) => {
      const slug = ["musicians", "modules", m.slug];
      const { body } = parse(path.join(MODULES, m.slug, m.doc));
      const html = rewriteAssets(rewriteLinks(marked.parse(body, { async: false }) as string, slug), m.slug);
      return { slug, audience: "musicians" as Audience, title: m.name, order: 1000, section: "musicians/modules", html };
    });
}

let cache: Doc[] | null = null;
export function allDocs(): Doc[] {
  if (cache) return cache;
  cache = walk(CONTENT)
    .map((file) => {
      const rel = path.relative(CONTENT, file).replace(/\\/g, "/").replace(/\.md$/, "");
      const slug = rel.split("/");
      const { meta, body } = parse(file);
      if (!(slug[0] in AUDIENCES)) throw new Error(`${file}: docs must live under ${Object.keys(AUDIENCES).join("/ or ")}/`);
      return {
        slug,
        audience: slug[0] as Audience,
        title: meta.title ?? slug[slug.length - 1],
        order: Number(meta.order ?? 1000),
        section: slug.slice(0, -1).join("/"),
        html: rewriteLinks(marked.parse(body, { async: false }) as string, slug),
      };
    })
    .concat(moduleDocs())
    .sort((a, b) => a.section.localeCompare(b.section) || a.order - b.order || a.title.localeCompare(b.title));
  for (const audience of Object.values(AUDIENCES))
    for (const item of audience.menu) {
      const target = item.href.match(/^\/docs\/(.+)\/$/)?.[1];
      if (target && !cache.some((d) => d.slug.join("/") === target)) throw new Error(`menu link ${item.href} has no doc`);
    }
  return cache;
}

export function docsFor(audience: Audience): Doc[] {
  return allDocs().filter((d) => d.audience === audience);
}

export function findDoc(slug: string[]): Doc | undefined {
  const key = slug.join("/");
  return allDocs().find((d) => d.slug.join("/") === key);
}

export function modules(): ModuleMeta[] {
  return fs
    .readdirSync(MODULES)
    .filter((d) => fs.existsSync(path.join(MODULES, d, "module.json")))
    .map((d) => {
      const m = JSON.parse(fs.readFileSync(path.join(MODULES, d, "module.json"), "utf8")) as ModuleMeta;
      if (m.slug !== d) throw new Error(`patch/modules/${d}/module.json: slug must be "${d}"`);
      return m;
    });
}

export function moduleDoc(m: ModuleMeta): Doc | undefined {
  return findDoc(["musicians", "modules", m.slug]);
}
