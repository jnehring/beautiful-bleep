// SPDX-License-Identifier: MIT
// bleep-markdown.js — renders the modules' documentation (modules/<name>/doc/<type>.md).
// A small Markdown subset, enough for the docs: headings, paragraphs, lists,
// tables, code (fenced or indented), **bold**, *italic*, `code`, links and
// images. Images and other files sit next to the .md and are referenced by
// file name; the board serves every doc folder flat.
//
//   BleepMarkdown.render(text) → HTML string
(function () {
  "use strict";
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const safeUrl = (u) => (/^\s*javascript:/i.test(u) ? "#" : u);

  function inline(s) {
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
    s = esc(s)
      .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => `<img src="${safeUrl(src)}" alt="${alt}">`)
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, href) => `<a href="${safeUrl(href)}">${t}</a>`)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?![*\w])/g, "$1<em>$2</em>")
      .replace(/(^|[^_\w])_([^_\s][^_]*?)_(?![_\w])/g, "$1<em>$2</em>");
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
  }

  const cells = (row) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  const isRule = (row) => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(row);

  function render(text) {
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    const out = [];
    let i = 0;
    const blank = (l) => !l.trim();
    const startsBlock = (l) => /^(#{1,6}\s|```|\s*[-*]\s|\s*\d+\.\s|\|)/.test(l) || /^ {4}/.test(l);
    while (i < lines.length) {
      const line = lines[i];
      if (blank(line)) { i++; continue; }
      let m;
      if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
        out.push(`<h${m[1].length}>${inline(m[2].trim())}</h${m[1].length}>`);
        i++;
      } else if (/^```/.test(line)) {
        const code = [];
        for (i++; i < lines.length && !/^```/.test(lines[i]); i++) code.push(lines[i]);
        i++;
        out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
      } else if (/^ {4}/.test(line)) {
        const code = [];
        while (i < lines.length && (/^ {4}/.test(lines[i]) || (blank(lines[i]) && /^ {4}/.test(lines[i + 1] || "")))) {
          code.push(lines[i].slice(4));
          i++;
        }
        out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
      } else if (/^\|/.test(line) && isRule(lines[i + 1] || "")) {
        const head = cells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && /^\|/.test(lines[i])) rows.push(cells(lines[i++]));
        out.push("<table><thead><tr>" + head.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>" +
          rows.map((r) => "<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>").join("") +
          "</tbody></table>");
      } else if ((m = /^\s*([-*]|\d+\.)\s+/.exec(line))) {
        const ordered = /\d/.test(m[1]);
        const items = [];
        while (i < lines.length && !blank(lines[i])) {
          const im = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
          if (im) items.push(im[2]);
          else items[items.length - 1] += " " + lines[i].trim();  // continuation line
          i++;
        }
        const tag = ordered ? "ol" : "ul";
        out.push(`<${tag}>` + items.map((it) => `<li>${inline(it)}</li>`).join("") + `</${tag}>`);
      } else {
        const para = [];
        while (i < lines.length && !blank(lines[i]) && (!para.length || !startsBlock(lines[i]))) para.push(lines[i++].trim());
        out.push(`<p>${inline(para.join(" "))}</p>`);
      }
    }
    return out.join("\n");
  }

  window.BleepMarkdown = { render };
})();
