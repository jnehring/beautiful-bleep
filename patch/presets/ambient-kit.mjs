// SPDX-License-Identifier: MIT
// Small helpers shared by the three Ambient categories (ambient-drones, ambient-textures, ambient-melodies):
// a source mixer and the big reverb every one of them ends in. Nothing here needs the transport.

/// An Audio Mixer fed by up to four sources: [{node, jacks?: [l, r], mono?: jack, level (dB), pan, send (dB)}].
export function bed(p, at, sources, values = {}) {
  const v = { master: -3, ...values };
  sources.forEach((s, i) => {
    v[`level${i + 1}`] = s.level ?? -8;
    v[`pan${i + 1}`] = s.pan ?? 0;
    if (s.send !== undefined) v[`send${i + 1}`] = s.send;
  });
  const mix = p.add("audio-mixer", at, v);
  sources.forEach((s, i) => {
    if (s.mono) p.cable(s.node, s.mono, mix, `in${i + 1}l`);
    else p.stereo(s.node, mix, { from: s.jacks || ["l", "r"], to: [`in${i + 1}l`, `in${i + 1}r`] });
  });
  return mix;
}

/// The mixer's send → an effect → the mixer's return (the effect at 100 % wet).
export function sendReturn(p, mix, fx) {
  p.cable(mix, "sendl", fx, "l").cable(mix, "sendr", fx, "r")
    .cable(fx, "l", mix, "returnl").cable(fx, "r", mix, "returnr");
}

/// A long hall from `from` (default: the mixer's Out L/R) to the cell's Out L/R. Returns the reverb.
export function hall(p, from, at, values = {}, jacks = ["outl", "outr"]) {
  const verb = p.add("reverb", at, { size: 0.85, decay: 9, damping: 0.5, modDepth: 0.4, mix: 0.45, quality: "Eco (8 lines)", ...values });
  p.stereo(from, verb, { from: jacks }).stereo(verb, p.cout);
  return verb;
}

/// A constant 1 (a gate that never falls, a level that never moves): a Utility with Offset at 100 %.
export function constant(p, at, name = "Held") {
  return p.add("utility", at, { scalex: 0, offset: 1 }, { name });
}
