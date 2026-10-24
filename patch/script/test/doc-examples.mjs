// SPDX-License-Identifier: GPL-3.0-only
// The library page's examples are the members of a module class, shown without the class around them. This wraps one into a whole module so that
// it can be compiled: the class has the input `x`, the output `out` and the field `sampleRate`, which the constructor sets.
export function wrapExample(code) {
  const imports = code.split("\n").filter((l) => /^import\b/.test(l));
  const body = code.split("\n").filter((l) => !/^import\b/.test(l)).join("\n");
  const ownField = /\bsampleRate\s*:\s*f64\s*(=|;)/.test(body);
  const ownCtor = /constructor\s*\(\s*sampleRate\s*:\s*f64\s*\)\s*\{/.test(body);
  const member = ownCtor ? body.replace(/constructor\s*\(\s*sampleRate\s*:\s*f64\s*\)\s*\{/, (m) => m + (ownField ? "" : " this.sampleRate = sampleRate;")) : body;
  return `${imports.join("\n")}
@module({ name: "Example" })
export class Example {
  @input({ name: "In", type: "audio" }) x: f32 = 0;
  @output({ name: "Out", type: "audio" }) out: f32 = 0;
${ownField ? "" : "  private sampleRate: f64 = 48000;\n"}${member}
${ownCtor ? "" : "  constructor(sampleRate: f64) { this.sampleRate = sampleRate; }\n"}}
`;
}
