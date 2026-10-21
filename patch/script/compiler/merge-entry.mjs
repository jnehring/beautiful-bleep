// SPDX-License-Identifier: GPL-3.0-or-later
// The entry of dist/bleep-script-merge.js: Binaryen's wasm-merge tool wrapped as a function (see wasm-merge.mjs). A separate file, because the
// tool is about 9 MB and only a script that imports a library module needs it; the compiler loads it then (bundle-entry.mjs).
import tool from "wasm-merge-tool";
export default tool;
