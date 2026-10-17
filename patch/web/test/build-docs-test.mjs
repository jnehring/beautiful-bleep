// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// patch/presets/build-docs.mjs: the generated sections of the module manuals and the outline check.
//
//   node patch/web/test/build-docs-test.mjs
import assert from "node:assert/strict";
import { checkOutline, demoBlock, presetBlock, sync } from "../../presets/build-docs.mjs";

const demos = [
  { name: "Grains: Frozen Cloud", preset: { description: "A slow LFO | on Freeze." } },
  { name: "Grains: Stutter", preset: { description: "Chops\na loop." } },
];
const presets = [{ name: "Pad", description: "Wide." }, { name: "Bare" }];

const manual = `# Grains

## Introduction

Text.

## How does it work?

Text.

## How to use it?

- one

## Demo patches

Hand-written intro.

| Patch | What it shows |
|---|---|
| **Old** | old text |

## Reference

### Knobs
`;

// a hand-written section becomes the generated one; the presets follow it; Reference stays after both
const once = sync(manual, "Grains", demos, presets);
assert.match(once, /<!-- generated:demos -->\n## Demo patches\n\nTwo whole patches show what Grains does\./);
assert.match(once, /\| \*\*Grains: Frozen Cloud\*\* \| A slow LFO \/ on Freeze\. \|/);   // pipes and newlines are gone from the cells
assert.match(once, /\| \*\*Grains: Stutter\*\* \| Chops a loop\. \|/);
assert.doesNotMatch(once, /Hand-written intro|\*\*Old\*\*/);
assert.ok(once.indexOf("<!-- generated:presets -->") > once.indexOf("<!-- /generated -->") && once.indexOf("## Reference") > once.lastIndexOf("<!-- /generated -->"));
assert.match(once, /\| \*\*Bare\*\* \|  \|/);   // a preset without a description

// idempotent: a second run changes nothing
assert.equal(sync(once, "Grains", demos, presets), once);

// changed presets only change the generated part
const changed = sync(once, "Grains", demos, [{ name: "Only", description: "One." }]);
assert.match(changed, /has 1 factory preset\./);
assert.doesNotMatch(changed, /\*\*Pad\*\*/);
assert.ok(changed.startsWith(once.slice(0, once.indexOf("<!-- generated:presets -->"))));

// no presets: the generated section goes away; no demos and no markers: a hand-written section is left alone
const noPresets = sync(once, "Grains", demos, []);
assert.doesNotMatch(noPresets, /generated:presets|## Presets/);
assert.match(noPresets, /<!-- generated:demos -->/);
assert.equal(sync(manual, "Grains", [], []), manual);
assert.doesNotMatch(sync(once, "Grains", [], []), /generated:/);

// a manual without a demo section gets one before Reference; one without Reference gets it at the end
const bare = "## Introduction\n\nx\n\n## How does it work?\n\nx\n\n## How to use it?\n\nx\n";
assert.match(sync(bare, "Bare", demos, []), /How to use it\?\n\nx\n\n<!-- generated:demos -->[\s\S]*<!-- \/generated -->\n$/);
const withRef = bare + "\n## Reference\n\ntable\n";
assert.ok(sync(withRef, "Bare", demos, []).indexOf("generated:demos") < sync(withRef, "Bare", demos, []).indexOf("## Reference"));

// an open marker without its end is an error
assert.throws(() => sync("## Introduction\n<!-- generated:demos -->\n## Demo patches\n", "X", demos, []), /no <!-- \/generated -->/);

// counts in words; singular
assert.match(demoBlock("X", [demos[0]]), /One whole patch shows what X does/);
assert.match(presetBlock("X", [presets[0]]), /has 1 factory preset\./);

// the outline
const ctx = { type: "grains", docDir: "/nonexistent", manuals: new Set(["grains", "adsr"]) };
const errs = (t) => checkOutline(t, ctx);
assert.deepEqual(errs(manual).filter((e) => !e.includes("screenshot")), []);
assert.ok(errs(manual).some((e) => e.includes("no screenshot grains.png")));
assert.ok(errs("## Introduction\n## How to use it?\n").some((e) => e.includes('no "## How does it work?"')));
assert.ok(errs("## How does it work?\n## Introduction\n## How to use it?\n").some((e) => e.includes("out of order")));
assert.ok(errs(manual + "\n![](pic.png)\n").some((e) => e.includes("has no alt text")));
assert.ok(errs(manual + "\n![shot](missing.png)\n").some((e) => e.includes("does not exist")));
assert.ok(errs(manual + "\n[x](nowhere.md)\n").some((e) => e.includes("nowhere.md")));
assert.ok(!errs(manual + "\n[x](adsr.md#a)\n").some((e) => e.includes("adsr.md")));
assert.ok(errs(once + "\n" + demoBlock("X", demos)).some((e) => e.includes("appears 2 times")));

console.log("build-docs-test: ok");
