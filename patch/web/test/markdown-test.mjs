// SPDX-License-Identifier: MIT
// bleep-markdown.js: hostile links and images must not produce a live scheme or an event handler.
//
//   node patch/web/test/markdown-test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const ctx = { window: {} };
vm.runInNewContext(readFileSync(join(here, "..", "..", "common", "ui", "bleep-markdown.js"), "utf8"), ctx);
const render = (t) => ctx.window.BleepMarkdown.render(t);
const href = (u) => { const m = /href="([^"]*)"/.exec(render(`[x](${u})`)); return m ? m[1] : "#"; };  // no match: not rendered as a link at all

for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", " javascript:alert(1)", "\u0001javascript:alert(1)", "java\tscript:alert(1)",
                   "java\nscript:alert(1)", "​javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:msgbox(1)",
                   "file:///etc/passwd", "blob:http://x/1", "//evil.example/x", "\\\\evil.example\\x", "&#106;avascript:alert(1)"]) {
  const out = href(bad);
  assert.ok(out === "#" || !/^[a-z][a-z0-9+.-]*:/i.test(out), `${JSON.stringify(bad)} -> ${out}`);
}
// the ones that are allowed
assert.equal(href("https://example.com/a?b=1"), "https://example.com/a?b=1".replace(/&/g, "&amp;"));
assert.equal(href("mailto:a@b.c"), "mailto:a@b.c");
assert.equal(href("#section"), "#section");
assert.equal(href("other.md"), "other.md");
assert.equal(href("sub/page.md#x"), "sub/page.md#x");
// external links get rel; internal ones do not
assert.match(render("[x](http://example.com)"), /rel="noopener noreferrer"/);
assert.doesNotMatch(render("[x](other.md)"), /rel=/);
// images: no inline handler, hostile sources neutralised, attributes stay escaped
const img = render('![a" onerror="alert(1)](javascript:alert(1))');
assert.match(img, /alt="a&quot; onerror=&quot;alert\(1\)"/);  // stays inside the escaped attribute
assert.doesNotMatch(img, /"\sonerror=/);
assert.match(render("![alt](pic.png)"), /<img src="pic.png" alt="alt"/);
assert.doesNotMatch(render("![alt](data:image/svg+xml,x)"), /src="data:/);
assert.doesNotMatch(render("![alt](pic.png)"), /onerror/);
const quote = render('[a](x"onmouseover="alert(1))');
assert.doesNotMatch(quote, /"onmouseover|\sonmouseover=/);

// a comment on a line of its own (the markers of generated sections) is not shown; text around it is
assert.equal(render("<!-- generated:demos -->\n## Demo patches\n\nText\n<!-- /generated -->"), "<h2>Demo patches</h2>\n<p>Text</p>");
assert.doesNotMatch(render("a <!-- b --> c"), /<!--/);   // inside a paragraph it stays escaped text
console.log("ok   markdown links, images and comments");
