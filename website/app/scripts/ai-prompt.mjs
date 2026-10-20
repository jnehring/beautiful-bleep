// SPDX-License-Identifier: MIT
// Writes the AI programming prompt (the ~~~~markdown block of the "Programming with AI" page) to public/bleep-script-ai-prompt.md, the file
// that page offers for download. The page is the only copy that is edited.   node scripts/ai-prompt.mjs
import fs from "node:fs";
import path from "node:path";

const page = path.resolve(import.meta.dirname, "..", "..", "content", "developers", "bleep-script", "ai-programming.md");
const out = path.resolve(import.meta.dirname, "..", "public", "bleep-script-ai-prompt.md");
const match = fs.readFileSync(page, "utf8").match(/^~~~~markdown\n([\s\S]*?)\n~~~~$/m);
if (!match) throw new Error(`${page}: no ~~~~markdown block with the prompt`);
fs.writeFileSync(out, match[1] + "\n");
console.log(`wrote ${path.relative(process.cwd(), out)} (${match[1].length} characters)`);
