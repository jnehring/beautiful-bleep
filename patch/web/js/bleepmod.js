// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// bleepmod.js — builds the package of a community module in the browser (the developer docs, "Publishing a module", "Share a module with the
// community"): an unsigned .bleepmod, a zip with module.json, module.wasm, spec.json, the help page as doc/<name>.md and the module's own picture as view.sandbox.js and, if the author shares it, the source as source.dsp.ts, and the tile's picture as image.png|jpg|webp. The library checks it,
// signs it and publishes it (PUT /api/registry/community/modules/<name>/<version>).
//
//   BleepMod.zip([{ name, data }])      Uint8Array: a zip with every file stored as it is (data: a string or bytes)
//   BleepMod.build({ handle, slug, version, title, summary, category, license, spec, wasm, help, view, source, image })   Uint8Array   (image: { data: Uint8Array, ext })
//   BleepMod.upload(bytes, slug, version, fetch?)   Promise<{ ok, id, version, error }>   the library's answer
(function (root) {
  "use strict";
  const enc = new TextEncoder();
  const bytesOf = (d) => (typeof d === "string" ? enc.encode(d) : d instanceof Uint8Array ? d : new Uint8Array(d));

  let table = null;
  function crc32(bytes) {
    if (!table) { table = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; } }
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function zip(files) {
    const DOS_TIME = 0, DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;   // 2020-01-01 00:00, like the library's own packages
    const parts = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name), data = bytesOf(f.data), crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);   // 0x0800: names are UTF-8
      local.setUint16(8, 0, true); local.setUint16(10, DOS_TIME, true); local.setUint16(12, DOS_DATE, true);   // method 0: stored
      local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
      parts.push(new Uint8Array(local.buffer), name, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint16(10, 0, true); c.setUint16(12, DOS_TIME, true); c.setUint16(14, DOS_DATE, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
      c.setUint16(28, name.length, true); c.setUint32(38, 0o100644 << 16 >>> 0, true); c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const size = central.reduce((n, p) => n + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, size, true); end.setUint32(16, offset, true);
    const all = [...parts, ...central, new Uint8Array(end.buffer)], out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of all) { out.set(p, at); at += p.length; }
    return out;
  }

  /// The package of one module: `spec` is the compiler's node type descriptions, compiled with the type id `<handle>/<slug>`.
  function build({ handle, slug, version, title, summary, category, license, spec, wasm, help, view, source, image }) {
    const text = (s, n) => String(s == null ? "" : s).slice(0, n);
    const meta = { types: spec.map((t) => t.type), requires: { engineAbi: 1 }, title: text(title, 120), summary: text(summary, 280), category: text(category, 64), license: text(license || "MIT", 120) };
    const files = [
      { name: "module.json", data: JSON.stringify(meta, null, 1) + "\n" },
      { name: "module.wasm", data: wasm },
      { name: "spec.json", data: JSON.stringify(spec) },
    ];
    if (help && String(help).trim()) files.push({ name: `doc/${slug}.md`, data: String(help) });
    if (image && image.data && /^(png|jpg|webp)$/.test(image.ext)) files.push({ name: `image.${image.ext}`, data: image.data });   // the picture on the library's tile
    if (source && String(source).trim()) files.push({ name: "source.dsp.ts", data: String(source) });   // so everyone can open the module in a Code node
    if (view && String(view).trim()) files.push({ name: "view.sandbox.js", data: String(view) });   // run only in the sandboxed worker frame, never in the page
    return zip(files);
  }

  /// Sends a package to the library as the logged-in user (the session cookie of the site). { ok, id, version } or { ok: false, error }.
  async function upload(bytes, slug, version, fetcher) {
    const f = fetcher || root.fetch.bind(root);
    try {
      const r = await f(`/api/registry/community/modules/${encodeURIComponent(slug)}/${encodeURIComponent(version)}`, {
        method: "PUT", body: bytes, credentials: "same-origin", headers: { "Content-Type": "application/octet-stream" },
      });
      let body = null;
      try { body = await r.json(); } catch (e) { /* no body */ }
      if (r.ok) return { ok: true, id: body && body.id, version: body && body.version };
      const d = body && body.detail;
      return { ok: false, status: r.status, error: r.status === 401 ? "You are not logged in to the library" : typeof d === "string" ? d : Array.isArray(d) && d[0] ? ((d[0].loc || []).slice(-1)[0] + ": " + d[0].msg) : `The library answered ${r.status}` };
    } catch (e) { return { ok: false, error: "The library cannot be reached" }; }
  }

  /// A picture kept as a data URL (png, jpeg or webp) as { data: Uint8Array, ext }, or null.
  function imageFromDataUrl(url) {
    const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(url || ""));
    if (!m) return null;
    const bin = root.atob(m[2]), data = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
    return { data, ext: m[1] === "jpeg" ? "jpg" : m[1] };
  }

  root.BleepMod = { zip, build, upload, crc32, imageFromDataUrl };
  if (typeof module !== "undefined" && module.exports) module.exports = root.BleepMod;
})(typeof window !== "undefined" ? window : globalThis);
