// SPDX-License-Identifier: MIT
// Reads the docs (website/content) and module metadata (patch/modules) at
// build time. Nothing outside website/ depends on this.
import fs from "node:fs";
import path from "node:path";
import { marked } from "marked";

const ROOT = path.resolve(process.cwd(), "..", "..");
const CONTENT = path.join(ROOT, "website", "content");
const MODULES = path.join(ROOT, "patch", "modules");

export type Doc = { slug: string[]; title: string; order: number; section: string; html: string };
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

let cache: Doc[] | null = null;
export function allDocs(): Doc[] {
  if (cache) return cache;
  cache = walk(CONTENT)
    .map((file) => {
      const rel = path.relative(CONTENT, file).replace(/\\/g, "/").replace(/\.md$/, "");
      const slug = rel.split("/");
      const { meta, body } = parse(file);
      return {
        slug,
        title: meta.title ?? slug[slug.length - 1],
        order: Number(meta.order ?? 1000),
        section: slug.slice(0, -1).join("/"),
        html: rewriteLinks(marked.parse(body, { async: false }) as string, slug),
      };
    })
    .sort((a, b) => a.section.localeCompare(b.section) || a.order - b.order);
  return cache;
}

export function findDoc(slug: string[]): Doc | undefined {
  const key = slug.join("/");
  return allDocs().find((d) => d.slug.join("/") === key);
}

export function modules(): ModuleMeta[] {
  return fs
    .readdirSync(MODULES)
    .filter((d) => fs.existsSync(path.join(MODULES, d, "module.json")))
    .map((d) => JSON.parse(fs.readFileSync(path.join(MODULES, d, "module.json"), "utf8")) as ModuleMeta);
}
