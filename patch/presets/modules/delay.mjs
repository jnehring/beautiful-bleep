// SPDX-License-Identifier: MIT
// Delay: factory presets.
export default [
  ["Eighth Echo", { sync: "Tempo", ratel: "1/8", rater: "1/8", feedback: 0.4, highcut: 8000, mix: 0.3 }, "A clean tempo-synced eighth-note echo."],
  ["Dotted Eighth", { sync: "Tempo", ratel: "1/8.", rater: "1/8.", feedback: 0.45, highcut: 9000, mix: 0.3 }, "The rhythmic dotted echo that fills gaps."],
  ["Tape Slap", { timel: 90, timer: 90, feedback: 0.12, lowcut: 100, highcut: 5000, mix: 0.25 }, "Short slapback with a dull top."],
  ["Ping-Pong Bounce", { sync: "Tempo", ratel: "1/8", rater: "1/8", mode: "Ping-Pong", feedback: 0.5, highcut: 9000, mix: 0.35 }, "Repeats bounce left and right."],
  ["Stereo Offset", { timel: 280, timer: 420, feedback: 0.35, highcut: 10000, mix: 0.3 }, "Different times per side widen the echo."],
  ["Dub Echo", { sync: "Tempo", ratel: "1/4.", rater: "1/4.", feedback: 0.65, lowcut: 250, highcut: 3500, mix: 0.4 }, "Filtered, long repeats that darken as they fade."],
  ["Triplet Ping-Pong", { sync: "Tempo", ratel: "1/8T", rater: "1/8T", mode: "Ping-Pong", feedback: 0.55, highcut: 8000, mix: 0.3 }, "Rolling triplet bounce."],
  ["Quarter Note Wash", { sync: "Tempo", ratel: "1/4", rater: "1/4", feedback: 0.6, lowcut: 150, highcut: 6000, mix: 0.35 }, "Spacious quarter-note repeats."],
  ["Chorus Doubler", { timel: 18, timer: 26, feedback: 0.1, mix: 0.4 }, "Very short times thicken a sound like a double-track."],
  ["Comb Resonance", { timel: 4, timer: 5, feedback: 0.85, lowcut: 100, highcut: 12000, mix: 0.5 }, "Millisecond delays with feedback ring as a metallic comb."],
  ["Long Haunt", { timel: 1100, timer: 1500, feedback: 0.7, lowcut: 200, highcut: 4000, mix: 0.4 }, "Slow, distant repeats for ambience."],
  ["Half Note Ping-Pong", { sync: "Tempo", ratel: "1/2", rater: "1/2", mode: "Ping-Pong", feedback: 0.5, highcut: 7000, mix: 0.4 }, "Wide, slow bounces."],
  ["Thin Radio Echo", { timel: 220, timer: 220, feedback: 0.5, lowcut: 900, highcut: 3000, mix: 0.4 }, "Band-limited, small-speaker echo."],
  ["Endless Repeat", { timel: 450, timer: 600, feedback: 0.93, lowcut: 200, highcut: 5000, mix: 0.45 }, "Near-infinite feedback; the filters keep it from blowing up."],
];
