// SPDX-License-Identifier: MIT
// Drum FX: zaps, metal, bells and noise hits. Trig and Velocity in, Out L/R.
import { category } from "./kit.mjs";
import { drum, layer, effect, HP, BP } from "./drum-kit.mjs";

const sonar = () => drum("Sonar Ping", {
  description: "A pure, slowly fading ping that echoes away like a signal under water.",
  tags: ["fx", "ping", "echo", "sci-fi"],
  help: "A Perc Voice in its FM engine at 1.4 kHz with almost no sweep and a half-second decay, into a " +
         "Delay in ping-pong mode with a dark feedback.\n\n" +
         "Patch a trigger into Trig and Out L/R. Velocity feeds the accent.\n\n" +
         "Tip: set the delay's Sync to Tempo to make the echoes fall on the beat.",
  layers: [layer("perc-voice", "Ping", { engine: "FM", pitch: 1400, tone: 0, morph: 0.1, click: 0, decay: 0.5,
                                         sweep: 0.05, damp: 0.4 }, { gain: -3 })],
  effects: [effect("delay", "Echo", { timel: 340, timer: 510, feedback: 0.5, highcut: 3500, mix: 0.4,
                                      mode: "Ping-Pong" })],
});

const coin = () => drum("Coin Chirp", {
  description: "Two bright square-ish chirps one fifth apart: a game pickup sound.",
  tags: ["fx", "game", "chiptune", "blip"],
  help: "Two Perc Voice layers in the FM engine, 1.2 kHz and 1.8 kHz, both short, mixed together and " +
         "crunched slightly for an 8-bit edge.\n\n" +
         "Patch a trigger into Trig and take Out L/R. Velocity sets the level.\n\n" +
         "Tip: lower Bits in the Crunch for more lo-fi grit.",
  layers: [layer("perc-voice", "Low Chirp", { engine: "FM", pitch: 1200, tone: 0.2, morph: 0.4, click: 0.1, decay: 0.07,
                                              sweep: 0, damp: 0.5 }, { gain: -4 }),
           layer("perc-voice", "High Chirp", { engine: "FM", pitch: 1800, tone: 0.2, morph: 0.4, click: 0, decay: 0.3,
                                               sweep: 0, damp: 0.4 }, { gain: -4 })],
  effects: [effect("crunch", "Crunch", { drive: 0.2, bits: 6, rate: 0.2, mix: 1 })],
});

const glass = () => drum("Glass Shatter", {
  description: "A burst of bright dust and a ringing glassy shard, high and sparkling.",
  tags: ["fx", "glass", "crash", "sparkle"],
  help: "A Macro Osc in its Dust model for the falling shards and a high Modal Voice for the ring, summed " +
         "and high-passed, into a small bright Reverb.\n\n" +
         "One Trig fires both. Patch a trigger there and take Out L/R. Velocity reaches both.\n\n" +
         "Tip: raise the high-pass Cutoff for thinner glass.",
  layers: [layer("macro-osc", "Shards", { model: "Dust", octave: 1, tone: 0.9, shape: 0.7, decay: 0.7 }, { gain: -4 }),
           layer("modal-voice", "Ring", { coarse: 24, geometry: 0.8, brightness: 0.85, damping: 0.3, position: 0.6 },
                 { gain: -6 })],
  effects: [effect("filter", "High-pass", { cutoff: 2500, mode: HP }),
            effect("reverb", "Room", { size: 0.4, decay: 1.2, damping: 0.2, mix: 0.2 })],
});

const boing = () => drum("Cartoon Boing", {
  description: "A rubbery spring wobble: a falling FM tone swept through a phaser.",
  tags: ["fx", "boing", "cartoon", "spring"],
  help: "A Perc Voice in its FM engine at 500 Hz with a long, deep downward sweep and a low Tone, through a " +
         "slow Phaser with feedback for the wobble.\n\n" +
         "Patch a trigger into Trig and Out L/R. Velocity feeds the accent.\n\n" +
         "Tip: raise the Phaser's Rate for a faster spring.",
  layers: [layer("perc-voice", "Spring", { engine: "FM", pitch: 500, tone: 0.1, morph: 0.6, click: 0.1, decay: 0.6,
                                           sweep: 0.9, damp: 0.3 }, { gain: -5 })],
  effects: [effect("phaser", "Wobble", { rate: 5, depth: 0.8, centre: 500, feedback: 0.6, stages: "6", mix: 0.7 })],
});

const steam = () => drum("Steam Release", {
  description: "A hissing gust of high noise that swells down into a soft tail.",
  tags: ["fx", "noise", "hiss", "texture"],
  help: "A Perc Voice in its Noise Bank engine at 4 kHz with a long one-second decay, high-passed and widened " +
         "by a short Reverb.\n\n" +
         "Patch a trigger into Trig and take Out L/R. Velocity scales the burst.\n\n" +
         "Tip: use it on the offbeat as a breathing hat replacement, or hold it back for builds.",
  layers: [layer("perc-voice", "Steam", { engine: "Noise Bank", pitch: 4000, tone: 0.9, click: 0, decay: 1, sweep: 0.3,
                                          damp: 0.15 }, { gain: 2 })],
  effects: [effect("filter", "High-pass", { cutoff: 3000, mode: HP }),
            effect("reverb", "Room", { size: 0.3, decay: 0.8, mix: 0.2 })],
});

const static_ = () => drum("Static Crackle", {
  description: "A dry crackling burst like a bad cable, shaped by a band-pass and a little grit.",
  tags: ["fx", "crackle", "noise", "lo-fi"],
  help: "A Macro Osc in its Dust model with a quarter-second decay through a band-pass around 4 kHz and a " +
         "Crunch for grit.\n\n" +
         "Patch a trigger into Trig and Out L/R. Velocity feeds the oscillator's accent.\n\n" +
         "Tip: fire it in short rolls to make a stuttering glitch.",
  layers: [layer("macro-osc", "Dust", { model: "Dust", octave: 0, tone: 0.8, shape: 0.6, decay: 0.25 })],
  effects: [effect("filter", "Band-pass", { cutoff: 4000, resonance: 0.35, mode: BP }),
            effect("crunch", "Grit", { drive: 0.4, bits: 8, rate: 0.1, mix: 0.7 })],
});

const vowel = () => drum("Vowel Stab", {
  description: "A short, throaty vowel hit: a robotic 'oh' that decays quickly.",
  tags: ["fx", "vocal", "robot", "stab"],
  help: "A Macro Osc in its Vowel model, with Tone moving the vowel and a short decay, into a bit of Crunch.\n\n" +
         "Patch a trigger into Trig and take Out L/R. Velocity feeds the accent.\n\n" +
         "Tip: change the Macro Osc's Tone to sweep through other vowels.",
  layers: [layer("macro-osc", "Vowel", { model: "Vowel", octave: -1, tone: 0.3, shape: 0.5, decay: 0.3 })],
  effects: [effect("crunch", "Grit", { drive: 0.5, bits: 10, rate: 0, mix: 0.6 })],
});

const gong = () => drum("Distant Gong", {
  description: "A deep, bowed-metal gong swelling slowly in a huge space.",
  tags: ["fx", "gong", "cinematic", "metal"],
  help: "A Perc Voice in its Modal engine at 120 Hz with Tone at maximum so the partials turn metallic, a " +
         "long decay and an added dull click, into a big Reverb.\n\n" +
         "Patch a trigger into Trig and Out L/R. Velocity scales the strike.\n\n" +
         "Tip: use it for a slow downbeat; raise the reverb Decay for an even longer wash.",
  layers: [layer("perc-voice", "Gong", { engine: "Modal", pitch: 120, tone: 1, click: 0.15, decay: 5, sweep: 0,
                                         damp: 0.1 }, { gain: -5 })],
  effects: [effect("reverb", "Hall", { size: 0.9, decay: 5, damping: 0.4, mix: 0.3 })],
});

const chime = () => drum("Shimmer Chime", {
  description: "A tuned glass chime with an octave-up shimmer trailing behind it.",
  tags: ["fx", "chime", "shimmer", "ambient"],
  help: "A Modal Voice struck two octaves up, fed through a Pitch Shifter a fifth up with some feedback, into a " +
         "Reverb.\n\n" +
         "Patch a trigger into Trig and take Out L/R. Velocity sets the strike strength.\n\n" +
         "Tip: change the shifter's Pitch to 12 for a pure octave shimmer.",
  layers: [layer("modal-voice", "Chime", { coarse: 19, geometry: 0.6, brightness: 0.75, damping: 0.2, position: 0.3 },
                 { gain: -4 })],
  effects: [effect("pitch-shifter", "Shimmer", { pitch: 7, window: 120, feedback: 0.4, mix: 0.45 }),
            effect("reverb", "Hall", { size: 0.75, decay: 3.5, mix: 0.3 })],
});

const alien = () => drum("Alien Clang", {
  description: "A metal clang pulled out of tune by a frequency shifter: inharmonic and unsettling.",
  tags: ["fx", "alien", "inharmonic", "metal"],
  help: "A Ring Cowbell with a long decay through a Freq Shifter with feedback, which makes the partials " +
         "drift apart into a spiralling, bell-like ring.\n\n" +
         "Patch a trigger into Trig and Out L/R. Velocity scales it.\n\n" +
         "Tip: set the shifter's Shift to a negative value for a downward spiral.",
  layers: [layer("ring-cowbell", "Clang", { tune: -5, decay: 1.2, tone: 0.7 })],
  effects: [effect("freq-shifter", "Shifter", { shift: 0.1, feedback: 0.4, fbDelay: 0.3, mix: 0.7 })],
});

export default category("Drums/FX", "Pings, chirps, glass, gongs and noise hits for fills and transitions.",
  [sonar, coin, glass, boing, steam, static_, vowel, gong, chime, alien]);
