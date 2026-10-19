// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// board-code-worker.js — runs the Bleep Script compiler (bleep-script-compiler.js, patch/script) off the page: it takes seconds of
// CPU the first time, and it needs a plain JavaScript environment (the board seals the built-ins in the page).
//   page -> worker   { id, cmd: "init" }                         -> { id, examples } | { id, error }
//                    { id, cmd: "compile", source, typeId }       -> { id, result } | { id, error }
// The bundle is imported here, not statically, so that a failure to load it comes back as an error message.
const loaded = import("./bleep-script-compiler.js");

self.onmessage = async ({ data }) => {
  const { id, cmd } = data;
  try {
    const c = await loaded;
    if (cmd === "init") self.postMessage({ id, examples: c.examples });
    else if (cmd === "compile") self.postMessage({ id, result: await c.compile(data.source, { typeId: data.typeId }) });
  } catch (e) {
    self.postMessage({ id, error: String((e && e.stack) || e) });
  }
};
