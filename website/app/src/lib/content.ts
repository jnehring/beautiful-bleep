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
/** `doc` is relative to the module's folder, e.g. "doc/adsr.md". `category` is optional: the
 *  board's type list (patch/board/ui/demo-types.json) knows it for every built module. */
type ModuleJson = { name: string; slug: string; tagline: string; colour: string; formats: string[]; doc: string; category?: string };
/** One documented module: a folder's module.json, or one node of a kit (Ring Drums has a doc per drum). */
export type ModuleMeta = {
  name: string; slug: string; tagline: string; colour: string; formats: string[]; doc: string;
  folder: string;     // patch/modules/<folder>
  category: string;   // one of CATEGORIES, or "Other"
};

/** The board's Add menu order. "Drums/Ring" is Module › Drums › Ring. */
export const CATEGORIES = ["Sources", "Modulation", "Audio", "Utility", "Controllers", "Sequencing", "Drums/Ring", "Drums/Punch"];
export const categoryTitle = (c: string) => c.replace("/", " · ");
export const categorySlug = (c: string) => c.toLowerCase().replace(/[^a-z]+/g, "-");
const categoryRank = (c: string) => (CATEGORIES.includes(c) ? CATEGORIES.indexOf(c) : CATEGORIES.length);

/** Sidebar heading for a module section ("musicians/modules/03-audio"). */
export function moduleSection(category: string): string {
  return `musicians/modules/${String(categoryRank(category)).padStart(2, "0")}-${categorySlug(category)}`;
}

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

/** Links between module docs (ring-kick.md) go to the module pages. */
function rewriteModuleLinks(html: string): string {
  return html.replace(/href="([\w-]+)\.md(#[^"]*)?"/g, (_m, target: string, hash = "") => `href="/modules/${target}/${hash}"`);
}

function moduleDocs(): Doc[] {
  return modules()
    .filter((m) => fs.existsSync(path.join(MODULES, m.folder, m.doc)))
    .map((m) => {
      const { body } = parse(path.join(MODULES, m.folder, m.doc));
      const html = rewriteAssets(rewriteModuleLinks(marked.parse(body, { async: false }) as string), m.folder);
      return {
        slug: ["musicians", "modules", m.slug], audience: "musicians" as Audience, title: m.name,
        order: 1000, section: moduleSection(m.category), html,
      };
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

/** type id → { name, category } of the nodes the board offers (generated by bleep_dump_types). */
function boardTypes(): Map<string, { name: string; category: string }> {
  const file = path.join(ROOT, "patch", "board", "ui", "demo-types.json");
  const types = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as { type: string; name: string; category: string }[]) : [];
  return new Map(types.map((t) => [t.type, t]));
}

let moduleCache: ModuleMeta[] | null = null;
/** Every module that has a doc, by category and then name. A folder with several docs (the drum kits) yields one entry per doc. */
export function modules(): ModuleMeta[] {
  if (moduleCache) return moduleCache;
  const types = boardTypes();
  const out: ModuleMeta[] = [];
  for (const folder of fs.readdirSync(MODULES)) {
    const file = path.join(MODULES, folder, "module.json");
    if (!fs.existsSync(file)) continue;
    const m = JSON.parse(fs.readFileSync(file, "utf8")) as ModuleJson;
    if (m.slug !== folder) throw new Error(`patch/modules/${folder}/module.json: slug must be "${folder}"`);
    const docDir = path.join(MODULES, folder, "doc");
    const docs = fs.existsSync(docDir) ? fs.readdirSync(docDir).filter((f) => f.endsWith(".md")).sort() : [];
    // The folder's own doc (module.json) and one per node type: doc/<type>.md.
    const files = new Set([m.doc, ...docs.map((f) => `doc/${f}`)].filter(Boolean));
    for (const doc of files) {
      if (!fs.existsSync(path.join(MODULES, folder, doc))) continue;  // module.json names a doc that isn't written yet
      const slug = path.basename(doc, ".md");
      const t = types.get(slug);
      const category = t?.category ?? m.category ?? "Other";
      const own = slug === folder;
      out.push({
        name: t?.name ?? (own ? m.name : slug),
        slug, folder, doc, category,
        tagline: own ? m.tagline : firstSentence(path.join(MODULES, folder, doc)),
        colour: m.colour, formats: m.formats,
      });
    }
  }
  moduleCache = out.sort((a, b) =>
    categoryRank(a.category) - categoryRank(b.category) ||
    Number(b.slug === b.folder && !types.has(b.slug)) - Number(a.slug === a.folder && !types.has(a.slug)) ||  // a kit's overview first
    a.name.localeCompare(b.name));
  return moduleCache;
}

/** Modules grouped for the menus, in the board's category order. */
export function modulesByCategory(): { category: string; title: string; slug: string; modules: ModuleMeta[] }[] {
  const groups = new Map<string, ModuleMeta[]>();
  for (const m of modules()) groups.set(m.category, [...(groups.get(m.category) ?? []), m]);
  return [...groups.entries()].map(([category, list]) => ({ category, title: categoryTitle(category), slug: categorySlug(category), modules: list }));
}

/** The first paragraph under "Introduction", cut to its first sentence: the card text of a module that has no module.json tagline of its own. */
function firstSentence(file: string): string {
  const { body } = parse(file);
  const para = body.split(/\n## [^\n]*\n/)[1]?.split("\n\n")[0] ?? "";
  const text = para.replace(/\s+/g, " ").trim();
  return text.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? text;
}

export function moduleDoc(m: ModuleMeta): Doc | undefined {
  return findDoc(["musicians", "modules", m.slug]);
}
