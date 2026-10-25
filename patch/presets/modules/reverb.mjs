// SPDX-License-Identifier: MIT
// Verb: factory presets.
export default [
  ["Small Room", { size: 0.2, decay: 0.6, diffusion: 0.6, damping: 0.5, mix: 0.2 }, "A tight room for natural ambience."],
  ["Medium Hall", { size: 0.55, decay: 2.5, diffusion: 0.75, damping: 0.4, mix: 0.3 }, "General-purpose hall."],
  ["Bright Plate", { size: 0.4, decay: 1.8, diffusion: 0.9, damping: 0.15, preDelay: 0.005, tone: 0.3, mix: 0.3 }, "Dense, bright and fast building plate."],
  ["Vocal Space", { size: 0.45, decay: 1.6, preDelay: 0.04, diffusion: 0.7, damping: 0.5, mix: 0.22 }, "Pre-delay keeps a voice clear in front."],
  ["Warm Chamber", { size: 0.35, decay: 1.4, damping: 0.7, tone: -0.4, bass: 1.3, mix: 0.3 }, "Dark and cozy."],
  ["Big Cathedral", { size: 0.9, decay: 9, preDelay: 0.06, diffusion: 0.8, damping: 0.55, mix: 0.35 }, "Huge stone space with a long tail."],
  ["Wide Pad", { size: 0.8, decay: 12, diffusion: 0.85, damping: 0.4, modDepth: 0.5, width: 1.4, mix: 0.5 }, "A lush, wide wash for sustained sounds."],
  ["Shimmer Mod", { size: 0.7, decay: 6, modRate: 1.2, modDepth: 0.8, tone: 0.4, width: 1.2, mix: 0.4 }, "Heavy modulation gives a chorus-like shimmer."],
  ["Gated Snap", { size: 0.3, decay: 0.35, diffusion: 0.5, damping: 0.2, tone: 0.2, mix: 0.4 }, "Short, punchy burst for snares."],
  ["Dub Spring", { size: 0.25, decay: 2, diffusion: 0.2, damping: 0.3, tone: 0.2, modDepth: 0.4, mix: 0.3 }, "Sparse, metallic-sounding tail."],
  ["Dark Abyss", { size: 1, decay: 25, damping: 0.8, bass: 1.5, tone: -0.7, mix: 0.45 }, "Very long, dark and rumbling."],
  ["Infinite Freeze", { size: 0.7, decay: 60, diffusion: 0.85, damping: 0.3, modDepth: 0.4, width: 1.2, mix: 0.5 }, "Practically endless; gate Freeze to hold a chord."],
  ["Mono Closet", { size: 0.05, decay: 0.3, diffusion: 0.4, damping: 0.6, width: 0, mix: 0.15 }, "Very small and mono: a hint of space."],
  ["Eco Wash", { size: 0.6, decay: 4, quality: "Eco (8 lines)", mix: 0.3 }, "A cheaper eight-line reverb for busy patches."],
  ["Boing Spring", { type: "Spring", size: 0.4, decay: 2.2, diffusion: 0.75, damping: 0.35, modDepth: 0.55, mix: 0.4 }, "A bright coil that bends up on every hit and droops back: feed it clicks and snares."],
  ["Long Drip", { type: "Spring", size: 0.95, decay: 3.5, diffusion: 0.9, damping: 0.5, modDepth: 0.2, tone: -0.2, mix: 0.35 }, "A long coil with slow, separate drips; the lows trail behind the highs."],
  ["Tight Flutter", { type: "Spring", size: 0.05, decay: 1.2, diffusion: 0.3, damping: 0.45, modDepth: 0.1, tone: 0.2, mix: 0.3 }, "A short coil: fast metallic flutter with little chirp."],
  ["Held Coil", { type: "Spring", size: 0.6, decay: 60, diffusion: 0.85, damping: 0.3, modDepth: 0.4, width: 1.3, mix: 0.5 }, "An endless, wobbling metal drone; play into it, then lower Decay to let it go."],
  ["Studio Room", { room: "Studio", early: 0.6, size: 0.4, decay: 0.9, preDelay: 0.005, diffusion: 0.7, damping: 0.5, mix: 0.25 }, "Close, believable room: discrete early reflections around a short tail."],
  ["Chapel Echoes", { room: "Chapel", early: 0.8, size: 0.6, decay: 5, preDelay: 0.02, damping: 0.5, width: 1.2, mix: 0.35 }, "Distinct stone-wall echoes before a long, soft tail."],
];
