#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// A contact sheet of the factory panels, to look at them without the board:
//
//   node patch/presets/panels-gallery.mjs out.html [name ...]
//
// Draws every control as a static picture at the panel's grid (20 px a unit);
// the board's panel view will draw them live. Dev tool, not shipped.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));
const panels = read("../board/ui/factory-panels.json").panels;
const presets = read("../board/ui/factory-presets.json");
const category = Object.fromEntries(presets.presets.map((p) => [p.name, p.category]));
const U = 20;
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

let all = null;   // the panels of the preset being drawn, by id
const kids = (panel, tab) => panel.controls.filter((c) => !c.tab || c.tab === tab);

function control(c, colour) {
  const [x, y] = c.at, [w, h] = c.size;
  const box = `style="left:${x * U}px;top:${y * U}px;width:${w * U}px;height:${h * U}px;--c:${colour}"`;
  const lab = c.label ? `<i>${esc(c.label)}</i>` : "";
  switch (c.type) {
    case "label": return `<b class="title" ${box}>${esc(c.text)}</b>`;
    case "section": return `<div class="sec" style="left:${x * U}px;top:${y * U}px;width:${w * U}px;height:${h * U}px;--c:${c.colour}"><span>${esc(c.text)}</span></div>`;
    case "dial": return `<div class="dial" ${box}><svg viewBox="0 0 60 60"><path d="M12 48 A26 26 0 1 1 48 48" class="tr"/><path d="M12 48 A26 26 0 0 1 30 4" class="ar"/></svg>${lab}</div>`;
    case "slider": return `<div class="slider" ${box}><u></u>${lab}</div>`;
    case "wheel": return `<div class="slider wheel" ${box}><u></u>${lab}</div>`;
    case "button": return `<div class="btn" ${box}><s></s>${lab}</div>`;
    case "switch": return `<div class="sw" ${box}><u><em>◀</em><em>▶</em></u>${lab}</div>`;
    case "select": return `<div class="sel" ${box}><u>▾</u>${lab}</div>`;
    case "meter": return `<div class="meter" ${box}><u></u><u></u>${lab}</div>`;
    case "scope": return `<div class="scope" ${box}><svg viewBox="0 0 80 40" preserveAspectRatio="none"><path d="M0 20 Q10 0 20 20 T40 20 T60 20 T80 20"/></svg>${lab}</div>`;
    case "keys": {
      const n = c.octaves * 7;
      return `<div class="keys" ${box}>${"<u></u>".repeat(n)}</div>`;
    }
    case "view": return `<div class="view" ${box}><span>${esc(c.node)} view</span></div>`;
    case "panel": {
      const sub = all.find((p) => p.id === c.panel);
      return `<div class="panel sub" ${box.replace("style=\"", `style="width:${sub.cols * U}px;height:${sub.rows * U}px;`)}>${kids(sub).map((k) => control(k, colour)).join("")}</div>`;
    }
    default: return "";
  }
}

const names = process.argv.slice(3).length ? process.argv.slice(3) : Object.keys(panels);
const cards = names.map((name) => {
  const list = panels[name];
  all = list;
  const p = list[0];
  const tabs = p.tabs && p.tabs.length ? p.tabs : [{ id: undefined, name: "" }];
  const wires = list.flatMap((q) => q.controls).filter((c) => c.wire).length;
  return `<section><h2>${esc(name)} <small>${esc(category[name] || "")} · ${wires} wired controls${list.length > 1 ? ` · loads ${esc(list.slice(1).map((q) => q.name).join(", "))}` : ""}</small></h2>` +
    tabs.map((t) => `<div class="tabbed">${t.name ? `<div class="tabs">${tabs.map((u) => `<span class="${u === t ? "on" : ""}">${esc(u.name)}</span>`).join("")}</div>` : ""}` +
      `<div class="panel" style="width:${p.cols * U}px;height:${(t.rows || p.rows) * U}px">${kids(p, t.id).map((c) => control(c, "#5eead4")).join("")}</div></div>`).join("") +
    `</section>`;
}).join("\n");

writeFileSync(process.argv[2] || "panels.html", `<!doctype html><meta charset="utf-8"><title>Factory panels</title>
<style>
body{background:#15171c;color:#e7e9ee;font:13px system-ui;margin:20px}
h2{font-size:14px;margin:26px 0 6px}h2 small{color:#8b92a3;font-weight:400}
.panel{position:relative;background:#1d2027;border:1px solid #333;border-radius:10px}
.panel>*{position:absolute;box-sizing:border-box}
.panel.sub{background:none;border:0;border-radius:0}
.tabbed{margin-bottom:14px}.tabs{display:flex;gap:2px;margin-bottom:-1px;position:relative}.tabs span{padding:5px 14px;border:1px solid #333;border-bottom:0;border-radius:8px 8px 0 0;color:#8b92a3;background:#191c22}.tabs span.on{background:#1d2027;color:#e7e9ee}
.title{font-size:20px;font-weight:600;line-height:2;letter-spacing:.02em;color:#e7e9ee}
.sec{border:1px solid #3a4050;border-radius:8px;background:#20242c}
.sec span{position:absolute;left:10px;top:6px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--c)}
i{position:absolute;left:0;right:0;bottom:0;text-align:center;font-style:normal;font-size:11px;color:#8b92a3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dial svg{position:absolute;left:10px;top:0;width:60px;height:60px}.dial path{fill:none;stroke-width:5;stroke-linecap:round}.tr{stroke:#333b4a}.ar{stroke:#5eead4}
.slider u{position:absolute;left:50%;top:6px;bottom:20px;width:6px;margin-left:-3px;background:#333b4a;border-radius:3px}
.slider u:after{content:"";position:absolute;left:-8px;width:22px;height:10px;top:35%;background:#5eead4;border-radius:3px}
.wheel u{background:#4b5568;width:14px;margin-left:-7px;border-radius:7px}
.btn s{position:absolute;left:4px;right:4px;top:2px;bottom:20px;border:1px solid #4b5568;border-radius:6px;background:#252932}
.sw u,.sel u{position:absolute;left:2px;right:2px;top:4px;height:30px;border:1px solid #4b5568;border-radius:6px;background:#252932;display:flex;justify-content:space-between;align-items:center;padding:0 8px;font-style:normal;text-decoration:none}
.sw em{font-style:normal;color:#8b92a3;font-size:9px}
.meter u{position:absolute;bottom:20px;top:6px;width:10px;border-radius:2px;background:linear-gradient(#f87171,#facc15 25%,#4ade80 60%)}
.meter u:nth-of-type(1){left:10px}.meter u:nth-of-type(2){left:28px}
.scope svg{position:absolute;inset:0 0 18px 0;width:100%;height:calc(100% - 18px);background:#111318;border-radius:6px}.scope path{fill:none;stroke:#5eead4;stroke-width:1.5;vector-effect:non-scaling-stroke}
.keys{display:flex;background:#000;border-radius:0 0 6px 6px}.keys u{flex:1;background:#e7e9ee;margin-right:1px;border-radius:0 0 3px 3px}
.view{border:1px dashed #5eead4;left:auto;border-radius:8px;background:#161a21;display:grid;place-items:center;color:#5eead4}
</style><body>${cards}`);
