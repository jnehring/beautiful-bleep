// SPDX-License-Identifier: MIT
// Runs after `next build` (npm run build, the website Dockerfile): the static export writes inline <script> tags
// (self.__next_f.push(...), different on every page). Instead of 'unsafe-inline' for scripts, every page gets a
// <meta http-equiv="Content-Security-Policy"> that allows exactly the inline scripts it contains, by sha256.
// Caddy's CSP header stays for everything a meta tag cannot carry (frame-ancestors, ...) and for the other fetch directives, but it
// has NO script-src and no default-src: the browser applies header and meta together, so a policy that lacks 'unsafe-inline'
// in either one would block the hashed scripts too, and the page's script-src must live in the meta. Every page therefore gets
// the meta, also one without inline scripts. A page that already has its own CSP meta (Bleep Play's board UI under /play, built
// by scripts/build/build-web.sh: external scripts only) is left alone.
//
//   node scripts/csp-hashes.mjs [out-dir]      (default: out)
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? "out";
const MARK = 'data-bleep-csp="scripts"';
const OLD_META = /<meta http-equiv="Content-Security-Policy" data-bleep-csp="scripts" content="[^"]*"\/?>/g;
// An inline script is a <script> without src whose type (if any) is JavaScript. Attributes are not used by the export; anything
// unexpected makes the build fail rather than ship a page the policy would break.
const SCRIPT = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;

function* htmlFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* htmlFiles(p);
    else if (name.endsWith(".html")) yield p;
  }
}

let pages = 0, scripts = 0, own = 0;
for (const file of htmlFiles(root)) {
  let html = readFileSync(file, "utf8").replace(OLD_META, "");
  const hashes = new Set();
  for (const m of html.matchAll(SCRIPT)) {
    const attrs = m[1] ?? "";
    if (/\ssrc\s*=/i.test(attrs) || /^\s*$/.test(m[2])) continue;
    const type = /\stype\s*=\s*["']?([^\s"'>]+)/i.exec(attrs)?.[1]?.toLowerCase();
    if (type && type !== "module" && type !== "text/javascript") continue; // data blocks (application/json) never run
    hashes.add("'sha256-" + createHash("sha256").update(m[2], "utf8").digest("base64") + "'");
    scripts++;
  }
  if (/<meta[^>]+http-equiv=["']?content-security-policy/i.test(html)) { writeFileSync(file, html); own++; continue; }
  const policy = `script-src 'self' 'wasm-unsafe-eval' ${[...hashes].join(" ")}`;
  const meta = `<meta http-equiv="Content-Security-Policy" ${MARK} content="${policy}"/>`;
  const head = html.match(/<head[^>]*>/i);
  if (!head) throw new Error(`${file} has no <head>`);
  const at = head.index + head[0].length;
  writeFileSync(file, html.slice(0, at) + meta + html.slice(at));
  pages++;
}
console.log(`csp-hashes: ${scripts} inline scripts hashed; ${pages} pages got the meta policy, ${own} keep their own (${root})`);
