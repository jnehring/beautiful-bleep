// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// bleep-markdown.js — renders the modules' documentation (modules/<name>/doc/<type>.md).
// A small Markdown subset, enough for the docs: headings, paragraphs, lists,
// tables, code (fenced or indented), **bold**, *italic*, `code`, links and
// images; a comment on a line of its own is dropped. Images and other files sit next to the .md and are referenced by
// file name; the board serves every doc folder flat.
//
//   BleepMarkdown.render(text) → HTML string
(function () {
  "use strict";
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  // Allow-list: http(s), mailto, #fragments and relative paths; anything else (javascript:, data:, vbscript:, …) becomes "#".
  // Control characters and whitespace are stripped first, as browsers ignore them inside a scheme ("java\tscript:").
  // The input is already HTML-escaped (esc), so a decoded "&colon;" cannot appear: "&" stays "&amp;".
  const safeUrl = (u) => {
    const v = u.replace(/[\u0000-\u0020\u007f-\u009f\u00a0\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u2064\u3000\ufeff]/g, "");
    if (!v) return "#";
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(v);
    if (scheme) return /^(https?|mailto)$/i.test(scheme[1]) ? v : "#";
    if (/^[\\/]{2}/.test(v)) return "#";  // protocol-relative: another host, not a path of the docs
    return v;
  };
  const isExternal = (u) => /^https?:/i.test(u);

  function inline(s) {
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
    s = esc(s)
      .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => `<img src="${safeUrl(src)}" alt="${alt}" loading="lazy">`)
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, href) => {
        const u = safeUrl(href);
        return `<a href="${u}"${isExternal(u) ? ' target="_blank" rel="noopener noreferrer"' : ""}>${t}</a>`;
      })
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
    const startsBlock = (l) => /^(#{1,6}\s|```|\s*[-*]\s|\s*\d+\.\s|\|)/.test(l) || /^ {4}/.test(l) || /^\s*<!--.*-->\s*$/.test(l);
    while (i < lines.length) {
      const line = lines[i];
      if (blank(line)) { i++; continue; }
      let m;
      if (/^\s*<!--.*-->\s*$/.test(line)) {   // a comment on its own line (the markers of generated sections): not shown
        i++;
      } else if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
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
