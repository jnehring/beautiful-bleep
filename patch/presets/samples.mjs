// SPDX-License-Identifier: MIT
// Samples: cells that play recorded sounds (the factory samples in samples/) through Sampler and Grains.
import { cell, category, drumGrid, pattern } from "./kit.mjs";
import { samplerData, grainsData, equalMarkers } from "./media.mjs";

// A plain instrument cell: a Notes input and Out L/R.
const keys = (name, opts) => cell(name, opts).input("notes", "Notes", "notes").stereoOut();

// Aftertouch from Notes to CV brightens a Sampler (and lets the cell see the played notes). Returns the Notes to CV.
function touch(p, at, smp, amount = 0.25) {
  const n2c = p.add("notes-to-cv", at, {}, { name: "Keys" });
  p.cable(p.cin, "notes", n2c, "notes").cable(n2c, "pressure", smp, "cutoff", amount);
  return n2c;
}

// A gated, pitched stage for Grains clouds: Notes to CV -> ADSR -> VCA. Returns the pieces to cable.
function gate(p, at, adsr) {
  const n2c = p.add("notes-to-cv", at, { retrigger: "Off (Legato)" }, { name: "Keys" });
  const env = p.add("adsr", [at[0] + 1, at[1] + 1], adsr, { name: "Amp Env" });
  const amp = p.add("vca", [at[0] + 3, at[1]], {}, { name: "VCA" });
  p.cable(p.cin, "notes", n2c, "notes").cable(n2c, "gate", env, "gate").cable(n2c, "velocity", env, "velocity")
    .cable(env, "env", amp, "gain");
  return { n2c, env, amp };
}

// Piano C4 played across the keys, with a little felt and room.
function mezzoUpright() {
  const p = keys("Mezzo Upright", {
    description: "One recorded piano note played across the keyboard, softened by a touch of chorus and a small room; velocity plays the touch. Shared inputs Brightness and Room.",
    tags: ["piano", "sampled", "keys", "acoustic", "melodic"],
    help: "A Sampler holding a single mezzo-forte piano C4, transposed from the Root Note to every key. A very light " +
      "Chorus widens it and a small Verb adds a room. Velocity raises the level and, a little, the brightness.\n\n" +
      "Play it from Notes in and take Out L/R. Brightness opens the Sampler's low-pass filter; Room sets how much " +
      "reverb is mixed in.\n\n" +
      "Notes far from C4 get the sound of a speeded-up or slowed-down tape: play mostly within an octave or so of " +
      "middle C for the most natural result.",
  }).input("bright", "Brightness").input("room", "Room");
  const s = p.sample("piano-c4");
  const smp = p.add("sampler", [1, 0], { mode: "To end of sample", root: 60, voices: 10, attack: 0.002, release: 0.35, velocity: 0.7,
    cutoff: 7000, filterenv: 0, level: 1.1, quality: "Cubic" }, { data: samplerData(s), name: "Piano" });
  const cho = p.add("chorus", [2, 0], { rate: 0.35, depth: 0.25, delay: 12, spread: 0.8, mix: 0.18 });
  const verb = p.add("reverb", [3, 0], { size: 0.35, decay: 1.8, mix: 0.14, damping: 0.5 }, { name: "Room" });
  touch(p, [0, 1], smp);
  p.cable(p.cin, "notes", smp, "notes").cable(p.cin, "bright", smp, "cutoff", 0.3).cable(p.cin, "room", verb, "mix", 0.4)
    .stereo(smp, cho).stereo(cho, verb).stereo(verb, p.cout);
  return p;
}

// Crotale layered with an octave-up copy, ping-pong echoes.
function crotaleShimmer() {
  const p = keys("Crotale Shimmer", {
    description: "A struck crotale doubled an octave higher in Layers mode and sent through tempo-synced ping-pong echoes: icy, ringing chimes. Shared inputs Echo Mix and Ring.",
    tags: ["crotale", "bell", "chime", "echo", "sampled"],
    help: "A Sampler plays one fortissimo crotale in Layers mode: every key starts two playheads, the second an octave " +
      "above and a few milliseconds late, which thickens the strike into a shimmer. A tempo-synced Delay in ping-pong " +
      "mode and a Verb finish it.\n\n" +
      "Play it from Notes in. Echo Mix sets the delay level; Ring lengthens or shortens the Sampler's release. The " +
      "delay follows the cell's Clock input, or the transport when nothing is patched.\n\n" +
      "Play high, sparse notes and let the echoes answer; low notes turn the crotale into a gong.",
  }).input("echo", "Echo Mix").input("ring", "Ring");
  const s = p.sample("crotale-c6");
  const smp = p.add("sampler", [1, 0], { mode: "To end of sample", root: 84, voicemode: "Layers", layers: 2, layerpitch: 12, layeroffset: 12,
    release: 0.9, level: 1.1, voices: 12 }, { data: samplerData(s), name: "Crotale" });
  const dly = p.add("delay", [2, 0], { sync: "Tempo", ratel: "1/8.", rater: "1/4", mode: "Ping-Pong", feedback: 0.4, highcut: 9000, mix: 0.25 }, { name: "Echoes" });
  const verb = p.add("reverb", [3, 0], { size: 0.6, decay: 3.5, mix: 0.2 });
  touch(p, [0, 1], smp);
  p.cable(p.cin, "notes", smp, "notes").cable(p.cin, "echo", dly, "mix", 0.4).cable(p.cin, "ring", smp, "release", 0.4)
    .stereo(smp, dly).stereo(dly, verb).stereo(verb, p.cout);
  return p;
}

// Thai gong in three layers.
function gongChoir() {
  const p = keys("Gong Choir", {
    description: "A recorded Thai gong stacked in three layers a fifth apart, each starting slightly later and swelling in under a long reverb: a slow, bowed-sounding chord from one key. Shared inputs Bloom and Swell.",
    tags: ["gong", "layers", "ambient", "bell", "sampled"],
    help: "A Sampler in Layers mode with three playheads per key, each a fifth above the one before and 70 ms later, " +
      "with a soft attack, so a single note blooms into an open stack of fifths. A long Verb carries it away.\n\n" +
      "Play it from Notes in and take Out L/R. Bloom raises the reverb level; Swell lengthens the Sampler's attack.\n\n" +
      "Hold low notes and let them overlap; the gong's own beating partials make slow, moving harmonies.",
  }).input("bloom", "Bloom").input("swell", "Swell");
  const s = p.sample("thai-gong-a4");
  const smp = p.add("sampler", [1, 0], { mode: "To end of sample", root: 69, voicemode: "Layers", layers: 3, layerpitch: 7, layeroffset: 70,
    attack: 0.12, release: 2.5, level: 0.9, voices: 12, cutoff: 9000 }, { data: samplerData(s), name: "Gong" });
  const verb = p.add("reverb", [2, 0], { size: 0.85, decay: 7, mix: 0.35, damping: 0.45 });
  touch(p, [0, 1], smp);
  p.cable(p.cin, "notes", smp, "notes").cable(p.cin, "bloom", verb, "mix", 0.4).cable(p.cin, "swell", smp, "attack", 0.3)
    .stereo(smp, verb).stereo(verb, p.cout);
  return p;
}

// The wood loop cut into sixteen slices on the keys.
function woodSliceKeys() {
  const p = keys("Wood Slice Keys", {
    description: "One bar of claves, castanets, granite block and hi-hats cut into sixteen slices, one per key from middle C upwards: finger-drum a new bar, or let a sequencer rearrange it. Shared inputs Tone and Crush.",
    tags: ["slices", "wood", "percussion", "loop", "sampled"],
    help: "A Sampler with Slice Mode on holds the 120 BPM wood loop cut into sixteen equal slices. The key C4 plays the " +
      "first slice, C#4 the second, and so on up to D#5. Each slice plays to its end, whatever the key length.\n\n" +
      "Play it from Notes in: a step sequencer or an arpeggiator on a chromatic scale rearranges the bar. Tone " +
      "closes the Sampler's low-pass filter; Crush adds a lo-fi bit and rate reduction.\n\n" +
      "Select a slice in the Sampler view to give it its own pitch, level or reverse playback.",
  }).input("tone", "Tone").input("crush", "Crush");
  const s = p.sample("wood-loop");
  const smp = p.add("sampler", [1, 0], { mode: "To end of slice", slicemode: "On", root: 60, voices: 8, release: 0.03, level: 1.3, cutoff: 14000 },
    { data: samplerData(s, { markers: equalMarkers(s, 16), slicing: { kind: "beats", beats: 16 } }), name: "Slices" });
  touch(p, [0, 1], smp);
  p.cable(p.cin, "notes", smp, "notes").cable(p.cin, "tone", smp, "cutoff", 0.4).cable(p.cin, "crush", smp, "crush", 0.5)
    .stereo(smp, p.cout);
  return p;
}

// A groove of recorded wood, skin and metal hits, also playable from MIDI drum keys.
function woodGrooveKit() {
  const p = cell("Wood Groove Kit", {
    description: "A small kit of recorded hits (balloon thud, castanet, clave, tambourine, two hi-hats, granite tom, crash) that plays its own shuffle with the transport and answers General MIDI drum keys. Shared input Room.",
    tags: ["kit", "drums", "percussion", "groove", "sampled"],
    help: "A Drum Grid plays a one-bar groove on eight Samplers: a balloon pop pitched down as the kick, castanets as " +
      "the snare, a clave as the rim, a tambourine as the clap, closed and open hi-hat hits, a granite block as the " +
      "tom and a crash. Drum Notes adds the General MIDI keys on top, so you can fill in by hand; the grid's velocity " +
      "and the key's velocity both set each hit's level.\n\n" +
      "Start the transport and take Out L/R; patch Notes in from a keyboard or a MIDI drum track to add hits. Room " +
      "sets how much of the kit goes through a short reverb.\n\n" +
      "Every slot is a plain Sampler: select one to change its Transpose or Release, or load your own sample.",
  }).input("room", "Room").stereoOut();
  const mk = (name, at, sample, knobs) => {
    const s = p.sample(sample);
    return p.add("sampler", at, { triggerby: "CV", mode: "One-shot", root: 60, voices: 4, release: 0.05, velocity: 0.8, ...knobs },
      { data: samplerData(s), name });
  };
  const voices = [
    mk("Kick", [2, 0], "balloon-pop", { transpose: -10, level: 1.2, cutoff: 5000 }),
    mk("Snare", [3, 0], "castanet", { transpose: -3, level: 1.3 }),
    mk("Rim", [4, 0], "clave", { level: 1.1 }),
    mk("Clap", [5, 0], "tambourine", { level: 0.9 }),
    mk("Hat", [2, 1], "hihat-closed", { level: 0.9 }),
    mk("Open Hat", [3, 1], "hihat-open", { level: 0.9, release: 0.2 }),
    mk("Tom", [4, 1], "granite-block", { transpose: -7, level: 1.1 }),
    mk("Crash", [5, 1], "crash-cymbal", { level: 0.7, release: 0.4 }),
  ];
  const [kick, snare, rim, clap, hat, open, tom, crash] = voices;
  const grid = p.add("drum-grid", [0, 0], { velocity: 0.75, swing: 0.58 }, {
    data: drumGrid(["Kick", "Snare", "Rim", "Clap", "Hat", "Open Hat", "Tom", "Crash"], [
      pattern("Shuffle", [
        "X..x..x...X..x..",
        "....X.......X..x",
        "..x...x...x...x.",
        "....x.......x...",
        "x.xxx.xxx.xxx.xx",
        "......x.......x.",
        "...........x.x..",
        "X...............",
      ]),
    ]),
  });
  voices.forEach((v, i) => p.cable(grid, `gate${i + 1}`, v, "trigger").cable(grid, `velocity${i + 1}`, v, "velocity"));
  p.gmDrums({ kick: [kick, "trigger"], snare: [snare, "trigger"], rim: [rim, "trigger"], clap: [clap, "trigger"], hat: [hat, "trigger"],
    open: [open, "trigger"], tom: [tom, "trigger"], crash: [crash, "trigger"] }, [0, 2]);
  const verb = p.add("reverb", [6, 0], { size: 0.3, decay: 1.2, mix: 0.12, damping: 0.6 }, { name: "Room" });
  p.cable(p.cin, "room", verb, "mix", 0.4);
  for (const m of voices) p.stereo(m, verb);
  p.stereo(verb, p.cout);
  return p;
}

// A cymbal played backwards.
function reverseCymbalSwell() {
  const p = keys("Reverse Cymbal Swell", {
    description: "A crash cymbal played backwards: each key starts a rising swell that ends in a sudden stop, with a trailing reverb. Shared inputs Pitch and Brightness.",
    tags: ["cymbal", "reverse", "riser", "fx", "sampled"],
    help: "A Sampler plays the crash cymbal at Speed -1, so it runs from the tail to the hit and stops. The filter and " +
      "a Verb soften the end. Keys transpose the swell as well as change its length: higher notes make it shorter.\n\n" +
      "Play it from Notes in a moment before a downbeat. Pitch bends the whole swell up or down by an octave (the " +
      "faster the pitch, the shorter the rise); Brightness opens the filter.\n\n" +
      "Layer it under a normal crash or a drum hit for the classic build-up.",
  }).input("pitch", "Pitch").input("bright", "Brightness");
  const s = p.sample("crash-cymbal");
  const smp = p.add("sampler", [1, 0], { mode: "To end of sample", speed: -1, root: 60, voices: 4, release: 0.1, level: 1, cutoff: 9000 },
    { data: samplerData(s), name: "Backwards Crash" });
  const verb = p.add("reverb", [2, 0], { size: 0.7, decay: 3, mix: 0.25, damping: 0.45 });
  touch(p, [0, 1], smp);
  p.cable(p.cin, "notes", smp, "notes").cable(p.cin, "pitch", smp, "transpose", 0.25).cable(p.cin, "bright", smp, "cutoff", 0.3)
    .stereo(smp, verb).stereo(verb, p.cout);
  return p;
}

// A frozen tam-tam strike as a grain pad played from the keys.
function tamTamCloud() {
  const p = keys("Tam-Tam Cloud", {
    description: "Grains scatter a recorded tam-tam into a slowly breathing pad that follows the keys; the long attack and release hold chords together. Shared inputs Position and Blur.",
    tags: ["granular", "pad", "tam-tam", "texture", "sampled"],
    help: "Grains reads a recorded tam-tam instead of listening to an input and plays it as a cloud of overlapping " +
      "grains. Notes to CV sends the played key into Grains' Pitch input, so the cloud itself changes pitch, and an " +
      "ADSR on a VCA swells it in and out. Play a single key at a time: it is a mono cloud.\n\n" +
      "Patch Notes in from a keyboard. Position moves where in the strike the grains read (start of the crash on the " +
      "left, the long ring on the right); Blur washes the grains into one body.\n\n" +
      "Try an LFO or a slow envelope on Position for a pad that evolves by itself.",
  }).input("pos", "Position").input("blur", "Blur");
  const s = p.sample("tam-tam");
  const g = gate(p, [0, 0], { attack: 1.2, decay: 0.5, sustain: 0.9, release: 2.5, velamount: 0.3 });
  const gr = p.add("grains", [1, 0], { position: 0.35, size: 0.45, density: 0.6, texture: 0.5, spread: 0.55, pitchjitter: 0.15, blur: 0.4, feedback: 0.1,
    mix: 1, pitchquant: "Semitones", maxgrains: "32", freeze: true }, { data: grainsData(s), name: "Tam-Tam Grains" });
  const verb = p.add("reverb", [5, 0], { size: 0.8, decay: 5, mix: 0.25 });
  p.cable(g.n2c, "pitch", gr, "pitch").cable(p.cin, "pos", gr, "position", 0.5).cable(p.cin, "blur", gr, "blur", 0.5)
    .stereo(gr, g.amp).stereo(g.amp, verb).stereo(verb, p.cout);
  return p;
}

// Two rain recordings, panned apart, held by a key.
function rainWindow() {
  const p = keys("Rain Window", {
    description: "Two different recordings of steady rain looped and panned left and right: hold any key for a wide shower that fades in and out, whatever the pitch. Shared inputs Muffle and Level.",
    tags: ["rain", "ambience", "loop", "nature", "sampled"],
    help: "Two Samplers each loop a different steady-rain recording, one left and one right, with Key Tracking at " +
      "zero so every key plays the rain at its natural pitch. Attack and Release fade it in and out.\n\n" +
      "Play it from Notes in and hold a key. Muffle closes both filters, as if the window were shut; Level sets the " +
      "overall loudness.\n\n" +
      "Set the Transpose of one Sampler a few semitones away for a heavier or finer rain, or mix it under a pad.",
  }).input("muffle", "Muffle").input("level", "Level");
  const a = p.sample("rain-a"), b = p.sample("rain-b");
  const base = { mode: "Loop", root: 60, keytrack: 0, voices: 4, attack: 1.2, release: 2, loopfade: 0.03, cutoff: 12000, level: 1 };
  const left = p.add("sampler", [1, 0], { ...base, pan: -0.85 }, { data: samplerData(a), name: "Rain Left" });
  const right = p.add("sampler", [1, 1], { ...base, pan: 0.85 }, { data: samplerData(b), name: "Rain Right" });
  const amp = p.add("vca", [2, 0], { gain: 1 }, { name: "Level" });
  touch(p, [0, 2], left, 0.2);
  p.cable(p.cin, "notes", left, "notes").cable(p.cin, "notes", right, "notes")
    .cable(p.cin, "muffle", left, "cutoff", -0.5).cable(p.cin, "muffle", right, "cutoff", -0.5)
    .cable(p.cin, "level", amp, "gain", 0.5)
    .stereo(left, amp).stereo(right, amp).stereo(amp, p.cout);
  return p;
}

// Piano and crotale layered into a wide bell.
function glassPianoBell() {
  const p = keys("Glass Piano Bell", {
    description: "A piano note and a crotale an octave above, layered and spread across the stereo field with a wide chorus: a bright, glassy bell for slow melodies. Shared inputs Bell Level and Width.",
    tags: ["bell", "layered", "piano", "stereo", "sampled"],
    help: "Two Samplers share the same keys: a piano C5 panned slightly left, and a crotale an octave above, panned " +
      "right and quieter. A wide Chorus and a Verb blend them into one instrument.\n\n" +
      "Play it from Notes in and take Out L/R. Bell Level brings in more of the crotale; Width raises the chorus " +
      "mix and its stereo spread.\n\n" +
      "Play high, slow, wide intervals; the piano attack gives the front, the crotale the shine.",
  }).input("bell", "Bell Level").input("width", "Width");
  const pi = p.sample("piano-c5"), cr = p.sample("crotale-c6");
  const piano = p.add("sampler", [1, 0], { mode: "To end of sample", root: 72, release: 0.6, level: 1, pan: -0.35, voices: 10, cutoff: 10000 }, { data: samplerData(pi), name: "Piano" });
  const bell = p.add("sampler", [1, 1], { mode: "To end of sample", root: 84, transpose: 12, release: 0.8, level: 0.5, pan: 0.4, voices: 10 }, { data: samplerData(cr), name: "Crotale" });
  const cho = p.add("chorus", [2, 0], { rate: 0.28, depth: 0.45, delay: 14, spread: 1, mix: 0.4 }, { name: "Wide Chorus" });
  const verb = p.add("reverb", [3, 0], { size: 0.7, decay: 3.2, mix: 0.22 });
  touch(p, [0, 1], piano, 0.2);
  p.cable(p.cin, "notes", piano, "notes").cable(p.cin, "notes", bell, "notes")
    .cable(p.cin, "bell", bell, "level", 0.3).cable(p.cin, "width", cho, "mix", 0.4).cable(p.cin, "width", cho, "spread", 0.2)
    .stereo(piano, cho).stereo(bell, cho).stereo(cho, verb).stereo(verb, p.cout);
  return p;
}

// A rain texture that breathes with the grains.
function rainThread() {
  const p = keys("Rain Thread", {
    description: "Grains pick short drops out of a recording of rain and play them as a pitched, shimmering cloud: play a chord of single keys for a bright, sparkling rainfall. Shared inputs Size and Shimmer.",
    tags: ["granular", "rain", "shimmer", "texture", "sampled"],
    help: "Grains plays a rain recording as thousands of tiny drops. Pitch Quant keeps it to octaves and fifths, so the " +
      "scattered grains sound like a halo around the note you hold; Notes to CV sets the pitch and an ADSR on a VCA " +
      "fades it in and out. It plays one note at a time.\n\n" +
      "Patch Notes in from a keyboard. Size makes the drops longer and smoother or shorter and crackling; Shimmer " +
      "raises the pitch jitter and the feedback.\n\n" +
      "Play the notes slowly; low keys give a rumbling downpour, high keys a delicate drizzle.",
  }).input("size", "Size").input("shimmer", "Shimmer");
  const s = p.sample("rain-b");
  const g = gate(p, [0, 0], { attack: 0.8, decay: 0.4, sustain: 0.9, release: 1.8, velamount: 0.2 });
  const gr = p.add("grains", [1, 0], { position: 0.4, size: 0.2, density: 0.7, texture: 0.5, spread: 0.7, pitchjitter: 7, pitchquant: "Octaves + fifths",
    feedback: 0.2, blur: 0.3, mix: 1, freeze: true }, { data: grainsData(s), name: "Rain Grains" });
  p.cable(g.n2c, "pitch", gr, "pitch", 0.5).cable(p.cin, "size", gr, "size", 0.3).cable(p.cin, "shimmer", gr, "pitchjitter", 0.3)
    .cable(p.cin, "shimmer", gr, "feedback", 0.3)
    .stereo(gr, g.amp).stereo(g.amp, p.cout);
  return p;
}

export default category("Samples", "Cells that play recorded sounds: slicers, sample instruments and granular textures.", [
  mezzoUpright, crotaleShimmer, gongChoir, woodSliceKeys, woodGrooveKit, reverseCymbalSwell, tamTamCloud, rainWindow, glassPianoBell, rainThread,
]);
