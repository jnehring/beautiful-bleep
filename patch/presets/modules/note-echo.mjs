// SPDX-License-Identifier: MIT
// Note Echo: factory presets (repeats, time, decay, scale walk, Spread fan, Gravity).
export default [
  ["Dotted Eighth Tail", { rate: "1/8.", repeats: 5, decay: 0.35, length: 0.4 }, "Five fading repeats a dotted eighth apart: the classic rhythmic tail."],
  ["Slapback", { rate: "1/16", repeats: 1, decay: 0.5, length: 0.3 }, "One quiet, short repeat right behind the note."],
  ["Rising Staircase", { rate: "1/16", repeats: 8, decay: 0.15, steps: 1, length: 0.6 }, "Each repeat is one scale step higher: the note climbs the board's scale."],
  ["Falling Cascade", { rate: "1/16", repeats: 8, decay: 0.15, steps: -1, length: 0.6 }, "Each repeat one scale step lower: a tumbling run down the scale."],
  ["Triad Fan Up", { rate: "1/16", repeats: 6, decay: 0.12, spread: 0.5, fan: "Up", length: 0.7 }, "Repeats take the chord tones above the note in turn: an arpeggio from one key."],
  ["Triad Fan Down", { rate: "1/16", repeats: 6, decay: 0.12, spread: 0.5, fan: "Down", length: 0.7 }, "The same chord tones, falling."],
  ["Seventh Ping-Pong", { rate: "1/8T", repeats: 8, decay: 0.1, spread: 0.75, fan: "Up-Down", length: 0.6 }, "Four chord tones bounce up and down in triplets."],
  ["Random Sparkle", { rate: "1/32", repeats: 12, decay: 0.1, spread: 1, fan: "Random", drop: 0.3, length: 0.5 }, "Fast random chord tones with gaps: glitter around every note."],
  ["Sparse Ghosts", { rate: "1/8", repeats: 10, decay: 0.2, drop: 0.5, length: 0.35 }, "Half the repeats go missing, differently for every note."],
  ["Pulled Tight", { rate: "1/8T", repeats: 6, decay: 0.2, gravity: 1, grid: "1/16", length: 0.4 }, "Triplet spacing, dragged onto the sixteenth grid: a skipping, almost straight feel."],
  ["Off The Grid", { rate: "1/8", repeats: 6, decay: 0.2, gravity: -1, grid: "1/8", length: 0.4 }, "Repeats pushed halfway between the grid lines: behind-the-beat echoes."],
  ["Loose Pull", { rate: "1/16T", repeats: 8, decay: 0.15, gravity: 0.5, grid: "1/16", length: 0.5 }, "Gravity at half: repeats drift towards the grid without landing on it."],
  ["Free Wash", { rate: "Free", time: 0.35, repeats: 8, decay: 0.25, length: 0.9 }, "Repeats in seconds, not beats, long and overlapping: a wash behind the playing."],
  ["Echo Only", { rate: "1/4", repeats: 6, decay: 0.2, steps: 2, original: "Mute", length: 0.5 }, "The played note is muted: you hear only its climbing repeats."],
  ["Pentatonic Rain", { rate: "1/16", repeats: 12, decay: 0.12, steps: 1, drop: 0.2, scale: "Minor Pentatonic", root: "A", length: 0.5 }, "Climbing repeats in A minor pentatonic: nothing sounds wrong."],
  ["Fourths Climb", { rate: "1/8", repeats: 5, decay: 0.15, steps: 3, length: 0.5 }, "Three scale steps per repeat: open, fourth-like leaps."],
];
