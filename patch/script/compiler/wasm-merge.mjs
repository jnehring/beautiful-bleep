// SPDX-License-Identifier: GPL-3.0-or-later
// Runs Binaryen's `wasm-merge` tool (the npm package `binaryen`, bin/wasm-merge) on byte arrays, with no file system.
//
// The tool is an Emscripten build for node (NODERAWFS): it throws unless it sees node, and it reads and writes files through `fs`.
// It is the one linker Binaryen has, and the binaryen.js API has no merge, so it runs here inside a stand-in node: a `process`, a `require`
// and an in-memory `fs` that holds the input modules and catches the output. That works in a page or a worker, where there is no node.
//
// `tool` is the tool's source wrapped as a function (require, process, module, __filename, __dirname, globalThis, Module): node loads it
// with `loadToolFromSource`, the browser bundle wraps it when it is built (bundle.mjs), so nothing is evaluated at run time there.

const text = new TextEncoder();

/// Wraps the source of bin/wasm-merge (a node script) as the function mergeWasm calls. For node and the tests.
export function loadToolFromSource(source) {
  return new Function("require", "process", "module", "__filename", "__dirname", "globalThis", "Module", source.replace(/^#!.*\n/, ""));
}

// ---- a posix path, the part of node:path the tool uses -------------------------------------------------------------------------------
const path = {
  isAbsolute: (p) => p.startsWith("/"),
  normalize(p) {
    const abs = p.startsWith("/"), parts = [];
    for (const s of p.split("/")) {
      if (!s || s === ".") continue;
      if (s === ".." && parts.length && parts[parts.length - 1] !== "..") parts.pop(); else if (s !== ".." || !abs) parts.push(s);
    }
    return (abs ? "/" : "") + parts.join("/") || (abs ? "/" : ".");
  },
  dirname(p) { const i = p.replace(/\/+$/, "").lastIndexOf("/"); return i < 0 ? "." : i === 0 ? "/" : p.slice(0, i); },
  basename(p) { return p.replace(/\/+$/, "").split("/").pop(); },
  join: (...a) => path.normalize(a.filter(Boolean).join("/")),
  resolve: (...a) => { let r = ""; for (const s of a.reverse()) { r = r ? s + "/" + r : s; if (s.startsWith("/")) break; } return path.normalize(r.startsWith("/") ? r : "/" + r); },
};
path.posix = path;

// ---- an in-memory fs: files and directories, file descriptors, and the errors the tool expects ---------------------------------------
function fsError(code, syscall, p) {
  const e = new Error(`${code}: ${syscall} '${p}'`);
  e.code = code; e.errno = { ENOENT: -2, EEXIST: -17, ENOTDIR: -20, EISDIR: -21, EBADF: -9, ENOTEMPTY: -39, EINVAL: -22 }[code]; e.syscall = syscall; e.path = p;
  return e;
}

function makeFs(files, log) {
  const dirs = new Set(["/"]);
  const nodes = new Map();   // path -> { data: Uint8Array } for files
  for (const [name, data] of Object.entries(files)) nodes.set(path.resolve("/", name), { data });
  const fds = new Map();     // fd -> { path, node, pos }
  let nextFd = 10;
  const abs = (p) => path.resolve("/", String(p));
  const S_IFREG = 0o100000, S_IFDIR = 0o040000;
  const statOf = (isDir, size) => ({
    dev: 1, ino: 1, mode: (isDir ? S_IFDIR : S_IFREG) | 0o644, nlink: 1, uid: 0, gid: 0, rdev: 0, size, blksize: 4096, blocks: Math.ceil(size / 512),
    atimeMs: 0, mtimeMs: 0, ctimeMs: 0, atime: new Date(0), mtime: new Date(0), ctime: new Date(0), isDirectory: () => isDir, isFile: () => !isDir,
    isSymbolicLink: () => false, isCharacterDevice: () => false, isBlockDevice: () => false, isFIFO: () => false, isSocket: () => false,
  });
  const stat = (p, syscall = "stat") => {
    const a = abs(p);
    if (dirs.has(a)) return statOf(true, 4096);
    const n = nodes.get(a);
    if (!n) throw fsError("ENOENT", syscall, p);
    return statOf(false, n.data.length);
  };
  const grow = (n, size) => { if (size > n.data.length) { const d = new Uint8Array(Math.max(size, n.data.length * 2, 1024)); d.set(n.data); n.data = d; n.size = n.size ?? 0; } };
  const fd = (n) => { const e = fds.get(n); if (!e) throw fsError("EBADF", "fd", n); return e; };
  return {
    files: nodes,
    constants: { O_RDONLY: 0, O_WRONLY: 1, O_RDWR: 2, O_CREAT: 64, O_EXCL: 128, O_TRUNC: 512, O_APPEND: 1024, O_DIRECTORY: 65536, O_NOFOLLOW: 131072, O_SYNC: 1052672, O_NONBLOCK: 2048, O_NOCTTY: 256 },
    readFileSync(p) { const n = nodes.get(abs(p)); if (!n) throw fsError("ENOENT", "open", p); return n.data.subarray(0, n.size ?? n.data.length); },
    writeFileSync(p, data) { const b = typeof data === "string" ? text.encode(data) : new Uint8Array(data); nodes.set(abs(p), { data: b.slice(), size: b.length }); },
    statSync: (p) => stat(p), lstatSync: (p) => stat(p, "lstat"),
    fstatSync(n) { const e = fd(n); return e.dir ? statOf(true, 4096) : statOf(false, e.node.size ?? e.node.data.length); },
    openSync(p, flags) {
      const a = abs(p);
      if (dirs.has(a)) { const n = nextFd++; fds.set(n, { path: a, dir: true, pos: 0 }); return n; }
      let node = nodes.get(a);
      if (!node) { if (!(flags & 64)) throw fsError("ENOENT", "open", p); node = { data: new Uint8Array(1024), size: 0 }; nodes.set(a, node); }
      else if (flags & 512) node.size = 0;
      const n = nextFd++;
      fds.set(n, { path: a, node, pos: 0, append: !!(flags & 1024) });
      return n;
    },
    closeSync(n) { fds.delete(n); },
    readSync(n, buffer, offset = 0, length = buffer.length, position = null) {
      if (n <= 2) return 0;
      const e = fd(n), size = e.node.size ?? e.node.data.length, at = position ?? e.pos;
      const count = Math.max(0, Math.min(length, size - at));
      buffer.set(e.node.data.subarray(at, at + count), offset);
      if (position == null) e.pos += count;
      return count;
    },
    writeSync(n, buffer, offset = 0, length = buffer.length - offset, position = null) {
      if (n === 1 || n === 2) { log.push(String.fromCharCode(...buffer.subarray(offset, offset + length))); return length; }
      const e = fd(n), size = e.node.size ?? e.node.data.length, at = e.append ? size : position ?? e.pos;
      grow(e.node, at + length);
      e.node.data.set(buffer.subarray(offset, offset + length), at);
      e.node.size = Math.max(size, at + length);
      if (position == null) e.pos = at + length;
      return length;
    },
    ftruncateSync(n, len = 0) { const e = fd(n); grow(e.node, len); e.node.size = len; },
    truncateSync(p, len = 0) { const n = nodes.get(abs(p)); if (!n) throw fsError("ENOENT", "truncate", p); grow(n, len); n.size = len; },
    mkdirSync(p) { const a = abs(p); if (dirs.has(a) || nodes.has(a)) throw fsError("EEXIST", "mkdir", p); dirs.add(a); },
    readdirSync(p) {
      const a = abs(p), prefix = a === "/" ? "/" : a + "/";
      if (!dirs.has(a)) throw fsError("ENOENT", "scandir", p);
      return [...nodes.keys(), ...dirs].filter((k) => k !== a && k.startsWith(prefix) && !k.slice(prefix.length).includes("/")).map((k) => k.slice(prefix.length));
    },
    unlinkSync(p) { if (!nodes.delete(abs(p))) throw fsError("ENOENT", "unlink", p); },
    rmdirSync(p) { if (!dirs.delete(abs(p))) throw fsError("ENOENT", "rmdir", p); },
    renameSync(from, to) { const n = nodes.get(abs(from)); if (!n) throw fsError("ENOENT", "rename", from); nodes.delete(abs(from)); nodes.set(abs(to), n); },
    realpathSync: (p) => abs(p),
    chmodSync() {}, fchmodSync() {}, chownSync() {}, fchownSync() {}, utimesSync() {}, futimesSync() {}, lutimesSync() {},
    statfsSync: () => ({ type: 0, bsize: 4096, blocks: 0, bfree: 0, bavail: 0, files: 0, ffree: 0 }),
  };
}

/// Merges WebAssembly modules into one: the same as `wasm-merge a.wasm a b.wasm b … -o out.wasm`, so a module that imports from `a`
/// is linked to the exports of the module named `a`. Resolves to the merged bytes; rejects with the tool's message when it fails.
///   tool:    see the top of the file.
///   inputs:  [{ name, bytes }]  in the order the tool takes them (an import must come after the module it imports from).
///   options: { flags: [...] }   extra tool flags; the feature flags below are always on.
export async function mergeWasm(tool, inputs, { flags = [] } = {}) {
  const log = [];
  const files = {};
  const args = [
    "--enable-multimemory", "--enable-bulk-memory", "--enable-bulk-memory-opt", "--enable-mutable-globals", "--enable-sign-ext", "--enable-nontrapping-float-to-int",
    "--enable-exception-handling", "--enable-reference-types", "--rename-export-conflicts", ...flags,
  ];
  inputs.forEach((m, i) => { files[`in${i}.wasm`] = m.bytes; args.push(`in${i}.wasm`, m.name); });
  args.push("-o", "out.wasm");

  const fs = makeFs(files, log);
  const process = {
    argv: ["node", "wasm-merge", ...args], env: {}, platform: "linux", versions: { node: "20.0.0" }, exitCode: 0, stdin: { fd: 0 },
    cwd: () => "/", chdir() {}, on() {}, emit() {}, binding: () => ({ fs: fs.constants, os: {} }), exit(code) { process.exitCode = code; },
  };
  // the `globalThis` the tool sees: the real one, with a `process`. Reads go to the real global with the real global as the receiver (a browser's
  // `navigator` and the like are accessors that throw on anything else) and its functions are bound to it (setTimeout throws otherwise).
  const g = new Proxy(globalThis, {
    get(target, key) {
      if (key === "process") return process;
      const v = Reflect.get(target, key, target);
      return typeof v === "function" && typeof key === "string" && /^[a-z]/.test(key) ? v.bind(target) : v;
    },
    has: (target, key) => key === "process" || Reflect.has(target, key),
  });
  const require = (name) => {
    const n = name.replace(/^node:/, "");
    if (n === "fs") return fs;
    if (n === "path") return path;
    if (n === "tty") return { isatty: () => false };
    if (n === "crypto") return { randomFillSync: (view) => { for (let i = 0; i < view.length; i++) view[i] = (Math.random() * 256) | 0; return view; } };
    throw new Error(`wasm-merge: unexpected require("${name}")`);
  };
  const exited = new Promise((resolve, reject) => {
    const Module = {
      arguments: args, print: (s) => log.push(s), printErr: (s) => log.push(s),
      postRun: [() => resolve(process.exitCode)],   // the tool keeps its runtime alive, so this (after main) is its end, not onExit
      onAbort: (why) => reject(new Error(`wasm-merge aborted: ${why}`)),
    };
    try { tool(require, process, { exports: {} }, "/wasm-merge", "/", g, Module); } catch (e) { reject(e); }
  });
  const code = await exited;
  const out = fs.files.get("/out.wasm");
  if (code || !out) throw new Error(`wasm-merge failed${code ? ` (exit ${code})` : ""}: ${log.join("").trim() || "no output"}`);
  return out.data.slice(0, out.size ?? out.data.length);
}
