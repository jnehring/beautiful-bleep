// SPDX-License-Identifier: MIT
// Kicks: one-shot bass drums. Trig and Velocity in, Out L/R.
import { category } from "./kit.mjs";
import { drum, layer, effect } from "./drum-kit.mjs";

/// A shared "Tone" input that opens the effect `at` (an index into the nodes) by up to `amount` of the cutoff range.
const toneDial = (at, amount = 0.4) => (p, nodes) => {
  p.input("tone", "Tone", "control");
  p.cable(p.cin, "tone", nodes[at], "cutoff", amount);
};

const pocketThump = () => drum("Pocket Thump", {
  description: "A short, squeezed kick that sits in the pocket: a tight thump with the tail clamped off.",
  tags: ["kick", "tight", "compressed", "funk"],
  help: "A Punch Kick tuned to 62 Hz with a 0.3 s decay, run through a Compressor with a fast attack and a high " +
        "ratio, so the body is squashed and the click stays in front.\n\n" +
        "Patch a trigger into Trig and take Out L/R. Velocity scales the hit before it reaches the compressor.\n\n" +
        "Tip: lower the Compressor threshold for a flatter, more compact thump.",
  layers: [layer("punch-kick", "Kick", { tune: 62, decay: 0.3, sweep: 0.45, attack: 0.55, drive: 0.25 })],
  effects: [effect("compressor", "Squeeze", { threshold: -22, ratio: 8, attack: 3, release: 60, knee: 4, makeup: 6 })],
});

const velvetTape = () => drum("Velvet Tape Kick", {
  description: "A round, medium-long kick pushed into tape saturation for a soft, glued low end.",
  tags: ["kick", "tape", "warm", "saturated"],
  help: "A Ring Kick at 48 Hz with a 0.9 s decay into a Saturator in its Tape character. The saturation adds " +
        "harmonics so the kick is audible on small speakers, and rounds the top.\n\n" +
        "Patch a trigger into Trig and take Out L/R. The Tone input opens the Saturator's tone low-pass.\n\n" +
        "Tip: raise Drive on the Saturator for a thicker kick, or Sag for a looser, pumpier one.",
  layers: [layer("ring-kick", "Kick", { tune: 48, decay: 0.9, sweep: 0.35, tone: 0.25, drive: 0.05 })],
  effects: [effect("saturator", "Tape", { drive: 0.6, bias: 0, color: -0.2, sag: 0.2, age: 0, tone: 3500,
                                           character: "Tape" })],
  patch: (p, nodes) => {
    p.input("tone", "Tone", "control");
    p.cable(p.cin, "tone", nodes[1], "tone", 0.4);
  },
});

const cardboard = () => drum("Cardboard Box Kick", {
  description: "A lo-fi, bit-crushed kick that sounds like a cardboard box hit with a beater.",
  tags: ["kick", "lo-fi", "crushed", "bedroom"],
  help: "A Punch Kick at 70 Hz with a short decay, run through a Crunch module set to 7 bits with some sample-rate " +
        "reduction and a low-pass at 4 kHz. The steps in the signal give a papery, boxy tone.\n\n" +
        "Patch a trigger into Trig and take Out L/R. The Tone input opens the low-pass.\n\n" +
        "Tip: lower Bits on the Crunch for a more broken sound.",
  layers: [layer("punch-kick", "Kick", { tune: 70, decay: 0.28, sweep: 0.5, attack: 0.8, drive: 0.4 })],
  effects: [effect("crunch", "Crusher", { drive: 0.35, bits: 7, rate: 0.35, tone: 4000, level: 1, mix: 1 })],
  patch: (p, nodes) => {
    p.input("tone", "Tone", "control");
    p.cable(p.cin, "tone", nodes[1], "tone", 0.4);
  },
});

const woodLog = () => drum("Wooden Log Kick", {
  description: "A hollow, woody kick from a modal drum body: a muffled boom with a dry knock.",
  tags: ["kick", "acoustic", "wood", "organic"],
  help: "A Perc Voice in its Modal engine at 72 Hz with a lot of Damp, a short decay and moderate Click, as if " +
        "a log were struck with a soft mallet. A second, much quieter high layer adds the knock.\n\n" +
        "Patch a trigger into Trig and take Out L/R. Velocity feeds the accent of both layers.\n\n" +
        "Tip: raise Tone on the body layer to turn the log into something closer to a tom.",
  layers: [layer("perc-voice", "Body", { engine: "Modal", pitch: 72, tone: 0.15, click: 0.25, decay: 0.45,
                                         sweep: 0.3, damp: 0.7, spread: 0 }),
           layer("perc-voice", "Knock", { engine: "Modal", pitch: 240, tone: 0.5, click: 0.6, decay: 0.08,
                                          sweep: 0.1, damp: 0.8, spread: 0 }, { gain: -10 })],
});

const zap = () => drum("Electro Zap Kick", {
  description: "A laser-like electro kick: a fast FM pitch dive with a squelchy filtered edge.",
  tags: ["kick", "electro", "fm", "zap"],
  help: "A Perc Voice in its FM engine at 58 Hz with the Sweep at maximum, so the pitch and the FM index fall in " +
        "a quick zap, then a resonant Multi Filter that rounds the top.\n\n" +
        "Patch a trigger into Trig and Out L/R. The Tone input moves the filter cutoff.\n\n" +
        "Tip: raise the filter Resonance for a more vocal squelch.",
  layers: [layer("perc-voice", "Kick", { engine: "FM", pitch: 58, tone: 0.1, morph: 0.7, click: 0.5, decay: 0.35,
                                         sweep: 1, damp: 0.3, spread: 0 })],
  effects: [effect("filter", "Filter", { cutoff: 1400, resonance: 0.45, drive: 0.2, type: "Ladder Tanh" })],
  patch: toneDial(1, 0.35),
});

const pillow = () => drum("Pillow Kick", {
  description: "A soft, muffled kick with no click at all: the felt-beater thud for lo-fi and chill beats.",
  tags: ["kick", "soft", "muffled", "chill"],
  help: "A Ring Kick at 56 Hz with no drive and little tone, then a low-pass at 700 Hz, so " +
        "only the round thud is left.\n\n" +
        "Patch a trigger into Trig and take Out L/R. Velocity sets the hit; the Tone input opens the filter.\n\n" +
        "Tip: open Tone a little if the kick vanishes under a bass.",
  layers: [layer("ring-kick", "Kick", { tune: 56, decay: 0.5, sweep: 0.2, tone: 0.05, drive: 0 })],
  effects: [effect("filter", "Low-pass", { cutoff: 700, resonance: 0.05, type: "Ladder Linear" })],
  patch: toneDial(1, 0.5),
});

const twoStage = () => drum("Triple Stack Kick", {
  description: "Three layers in one hit: a click, a punchy mid and a sub sine, glued with a touch of saturation.",
  tags: ["kick", "layered", "club", "heavy"],
  help: "Three layers in one mixer: a short, bright Punch Kick click at 90 Hz, a Punch Kick body at 55 Hz, and a " +
        "Ring Kick sub at 38 Hz. A Saturator on the mix glues them.\n\n" +
        "One Trig fires all three. Patch a trigger there and take Out L/R. Velocity reaches every layer.\n\n" +
        "Tip: use the mixer levels to rebalance the stack: click for attack, sub for weight.",
  layers: [layer("punch-kick", "Click", { tune: 90, decay: 0.1, sweep: 0.8, attack: 1, drive: 0.3 }, { gain: -9 }),
           layer("punch-kick", "Body", { tune: 55, decay: 0.45, sweep: 0.55, attack: 0.4, drive: 0.3 }, { gain: -3 }),
           layer("ring-kick", "Sub", { tune: 38, decay: 1.2, sweep: 0.2, tone: 0, drive: 0 }, { gain: -6 })],
  effects: [effect("saturator", "Glue", { drive: 0.4, bias: 0, color: 0, sag: 0.3, age: 0, tone: 12000,
                                           character: "Diode", mix: 0.7 })],
});

const folded = () => drum("Folded Kick", {
  description: "A kick whose sine is wavefolded into a buzzy, harmonic-rich thud: aggressive and bright.",
  tags: ["kick", "wavefolder", "aggressive", "harmonic"],
  help: "A Punch Kick at 52 Hz into a Folder. The fold adds odd harmonics that follow the pitch drop, so the " +
        "kick has a buzzy tone as it falls. A low-pass at 6 kHz tames the highest folds.\n\n" +
        "Patch a trigger into Trig and take Out L/R. The Tone input opens the low-pass.\n\n" +
        "Tip: change the Folder's Symmetry for an uneven, more even-harmonic buzz.",
  layers: [layer("punch-kick", "Kick", { tune: 52, decay: 0.55, sweep: 0.6, attack: 0.3, drive: 0.1 })],
  effects: [effect("wavefolder", "Folder", { fold: 0.3, symmetry: 0.2, tap: 4, source: "Input", level: 0.6 }),
            effect("filter", "Low-pass", { cutoff: 6000, resonance: 0.1 })],
  patch: toneDial(2, 0.3),
});

const dusty = () => drum("Dusty Break Kick", {
  description: "A sampled-break style kick: a short, boxy thump with a rolled-off top and a little grit.",
  tags: ["kick", "breakbeat", "dusty", "boom bap"],
  help: "A Macro Osc in its Kick model one octave down, a 1-pole low-pass at 3 kHz and a gentle Crunch for dust. " +
        "It is a boxy, old-record kick for hip-hop and breaks.\n\n" +
        "Patch a trigger into Trig and take Out L/R. Velocity feeds the oscillator's accent. The Tone input " +
        "opens the low-pass.\n\n" +
        "Tip: the Macro Osc's Shape knob changes the click; lower it for a duller thud.",
  layers: [layer("macro-osc", "Kick", { model: "Kick", octave: -1, tone: 0.45, shape: 0.4, blend: 0.3, decay: 0.35 })],
  effects: [effect("filter", "Low-pass", { cutoff: 3000, resonance: 0.1, type: "1-Pole Low-pass" }),
            effect("crunch", "Dust", { drive: 0.3, bits: 11, rate: 0.1, tone: 8000, level: 1, mix: 0.6 })],
  patch: toneDial(1, 0.4),
});

const roomMic = () => drum("Room Mic Kick", {
  description: "A natural-sounding kick with a short room around it and a scooped low-mid: a live-room feel.",
  tags: ["kick", "room", "natural", "rock"],
  help: "A Punch Kick at 58 Hz, an EQ that scoops the muddy low-mids at 300 Hz and lifts the beater at 4 kHz, then " +
        "a small, short Reverb at 20 percent mix for the room.\n\n" +
        "Patch a trigger into Trig and take Out L/R. Velocity sets the level.\n\n" +
        "Tip: raise the Reverb mix for a more distant, bigger-room kick.",
  layers: [layer("punch-kick", "Kick", { tune: 58, decay: 0.5, sweep: 0.5, attack: 0.5, drive: 0.15 })],
  effects: [effect("eq", "Shape", { b2On: false, b3On: true, b3Type: "Bell", b3Hz: 300, b3Gain: -6, b3Q: 1.2,
                                    b4On: true, b4Type: "Bell", b4Hz: 4000, b4Gain: 4, b4Q: 0.8 }),
            effect("reverb", "Room", { size: 0.3, decay: 0.6, damping: 0.5, mix: 0.2 })],
});

const subDrop = () => drum("Sub Drop Kick", {
  description: "A very low, long kick that is more felt than heard: a sine sub that falls a long way.",
  tags: ["kick", "sub", "808", "long"],
  help: "A Ring Kick at 34 Hz with a long decay and a slow sweep, then a low-pass at 400 Hz so nothing but the sub is left.\n\n" +
        "Patch a trigger into Trig and take Out L/R. The Tone input opens the low-pass for a little more definition.\n\n" +
        "Tip: sidechain-free bass music works best with one of these per bar; shorten the Decay when the tempo is fast.",
  layers: [layer("ring-kick", "Sub", { tune: 34, decay: 2, sweep: 0.55, tone: 0.1, drive: 0.1 })],
  effects: [effect("filter", "Low-pass", { cutoff: 400, resonance: 0.05 })],
  patch: toneDial(1, 0.3),
});

const boom808 = () => drum("808 Boom Kick", {
  description: "A round, booming kick with a soft click and a long, gentle tail: the classic drum-machine bass drum.",
  tags: ["kick", "808", "boom", "hip hop"],
  help: "A Punch Kick at 45 Hz with a long decay, a low Attack and a slow sweep, into a Crunch used as a soft saturator for warmth.\n\n" +
        "Patch a trigger into Trig and take Out L/R. The Tone input opens the Crunch tone filter.\n\n" +
        "Tip: tune the Punch Kick to the key of the bass line.",
  layers: [layer("punch-kick", "Kick", { tune: 45, decay: 1.6, sweep: 0.3, attack: 0.2, drive: 0.15 })],
  effects: [effect("crunch", "Warmth", { drive: 0.35, bits: 16, tone: 6000, level: 1, mix: 1 })],
});

const technoRumble = () => drum("Techno Rumble Kick", {
  description: "A hard four-on-the-floor kick with a rumbling reverb tail that sits underneath the pattern.",
  tags: ["kick", "techno", "rumble", "club"],
  help: "A Punch Kick at 52 Hz with a strong click, then a big Reverb at 30 percent mix with a dark tone, and a Compressor that " +
        "holds the whole thing together.\n\n" +
        "Patch a trigger into Trig and take Out L/R. Velocity sets the hit.\n\n" +
        "Tip: shorten the Reverb Decay when the rumble starts to blur with the next kick.",
  layers: [layer("punch-kick", "Kick", { tune: 52, decay: 0.55, sweep: 0.6, attack: 0.7, drive: 0.35 })],
  effects: [effect("reverb", "Rumble", { size: 0.7, decay: 1.2, damping: 0.8, tone: -0.6, mix: 0.3 }),
            effect("compressor", "Glue", { threshold: -14, ratio: 4, attack: 5, release: 120, makeup: 3 })],
});

const gabber = () => drum("Gabber Distortion Kick", {
  description: "A hardcore kick pushed deep into distortion: a loud, buzzing thump with a pitched tail.",
  tags: ["kick", "gabber", "hardcore", "distorted"],
  help: "A Punch Kick at 48 Hz with Drive at full, into a Crunch with a lot of drive and a second Crunch for a buzzing top.\n\n" +
        "Patch a trigger into Trig and take Out L/R. Velocity sets the level.\n\n" +
        "Tip: lower the Crunch drive to get a harder club kick instead of a full gabber.",
  layers: [layer("punch-kick", "Kick", { tune: 48, decay: 0.7, sweep: 0.7, attack: 0.6, drive: 1 })],
  effects: [effect("crunch", "Crush", { drive: 0.75, bits: 14, tone: 8000, level: 0.8, mix: 1 }),
            effect("crunch", "Buzz", { drive: 0.5, bits: 16, tone: 12000, level: 0.9, mix: 1 })],
});

const clickBeater = () => drum("Click Beater Kick", {
  description: "A short, dry kick with a loud beater click on top: it cuts through a busy mix.",
  tags: ["kick", "click", "dry", "tight"],
  help: "A Punch Kick at 62 Hz with a short decay and the Attack at its top, plus a Ring Rim 8 dB down for the beater tick.\n\n" +
        "One Trig fires both. Patch a trigger there and take Out L/R. Velocity reaches both layers.\n\n" +
        "Tip: lower the Rim level for a softer beater, or raise it to hear the click first.",
  layers: [layer("punch-kick", "Kick", { tune: 62, decay: 0.22, sweep: 0.45, attack: 0.9, drive: 0.2 }),
           layer("ring-rim", "Beater", { voice: "Clave", tune: 7, decay: 0.3 }, { gain: -8 })],
});

const tapeThud = () => drum("Tape Thud Kick", {
  description: "A woolly, compressed kick that sounds as if it were bounced to tape and back.",
  tags: ["kick", "tape", "warm", "lo-fi"],
  help: "A Ring Kick at 56 Hz with some Tone, into a Crunch used as tape-style saturation, then a gentle low-pass.\n\n" +
        "Patch a trigger into Trig and take Out L/R. The Tone input opens the low-pass.\n\n" +
        "Tip: raise the Crunch drive for a more worn-out thud.",
  layers: [layer("ring-kick", "Kick", { tune: 56, decay: 0.7, sweep: 0.35, tone: 0.4, drive: 0.2 })],
  effects: [effect("crunch", "Tape", { drive: 0.5, bits: 16, tone: 9000, level: 1, mix: 1 }),
            effect("filter", "Soften", { cutoff: 5000, resonance: 0.05 })],
  patch: toneDial(2, 0.3),
});

const boomBap = () => drum("Boom Bap Sample Kick", {
  description: "A kick that sounds like it was chopped from a dusty record: crushed, short and a little boxy.",
  tags: ["kick", "boom bap", "sample", "lo-fi"],
  help: "A Ring Kick at 60 Hz with a medium decay, crunched to 10 bits with some sample-rate reduction, then low-passed at 3.5 kHz.\n\n" +
        "Patch a trigger into Trig and take Out L/R. The Tone input opens the low-pass.\n\n" +
        "Tip: pair it with the Crushed Snare for a whole sampled kit.",
  layers: [layer("ring-kick", "Kick", { tune: 60, decay: 0.45, sweep: 0.25, tone: 0.55, drive: 0.1 })],
  effects: [effect("crunch", "Dust", { drive: 0.2, bits: 10, rate: 0.25, tone: 20000, level: 1, mix: 1 }),
            effect("filter", "Low-pass", { cutoff: 3500, resonance: 0.1 })],
  patch: toneDial(2, 0.3),
});

const deepHouse = () => drum("Deep House Kick", {
  description: "A round, soft house kick with a slightly dark tone: it pushes without hurting.",
  tags: ["kick", "house", "deep", "round"],
  help: "A Ring Kick at 50 Hz with a medium decay and a low Drive, into an EQ that cuts the low-mids at 250 Hz and a short, tight Reverb.\n\n" +
        "Patch a trigger into Trig and take Out L/R. Velocity sets the level.\n\n" +
        "Tip: raise the Ring Kick's Tone for a bit more knock on the front.",
  layers: [layer("ring-kick", "Kick", { tune: 50, decay: 0.55, sweep: 0.3, tone: 0.3, drive: 0.1 })],
  effects: [effect("eq", "Shape", { b2On: false, b3On: true, b3Type: "Bell", b3Hz: 250, b3Gain: -5, b3Q: 1,
                                    b4On: false, b5On: false }),
            effect("reverb", "Room", { size: 0.2, decay: 0.4, damping: 0.6, mix: 0.1 })],
});

const fmPunch = () => drum("FM Punch Kick", {
  description: "A kick from a frequency-modulated voice: a hard, slightly metallic punch with a bright front.",
  tags: ["kick", "fm", "punch", "electronic"],
  help: "A Perc Voice in its FM engine at 55 Hz with a quick sweep and a short decay, mixed with a Punch Kick 6 dB down for weight.\n\n" +
        "One Trig fires both. Patch a trigger there and take Out L/R. Velocity reaches both layers.\n\n" +
        "Tip: raise Tone on the Perc Voice for more metallic overtones.",
  layers: [layer("perc-voice", "FM", { engine: "FM", pitch: 55, tone: 0.3, morph: 0.45, click: 0.5, decay: 0.35, sweep: 0.7, damp: 0.5 }),
           layer("punch-kick", "Weight", { tune: 50, decay: 0.4, sweep: 0.4, attack: 0.3, drive: 0.2 }, { gain: -6 })],
});

const trapSlide = () => drum("Trap Slide Kick", {
  description: "A long sub kick that slides down to the floor, for trap and drill.",
  tags: ["kick", "trap", "slide", "sub"],
  help: "A Punch Kick at 38 Hz with a very long decay and a large sweep, so the pitch slides down audibly, plus a small Crunch for harmonics.\n\n" +
        "Patch a trigger into Trig and take Out L/R. Velocity sets the level.\n\n" +
        "Tip: lower the Punch Kick's Sweep to make the slide shorter and the kick more of a thud.",
  layers: [layer("punch-kick", "Slide", { tune: 38, decay: 2.2, sweep: 0.85, attack: 0.15, drive: 0.25 })],
  effects: [effect("crunch", "Harmonics", { drive: 0.4, bits: 16, tone: 10000, level: 1, mix: 0.8 })],
});

export default category("Drums/Kicks", "One-shot bass drums, from soft thuds to layered club kicks: patch a trigger into Trig.",
  [pocketThump, velvetTape, cardboard, woodLog, zap, pillow, twoStage, folded, dusty, roomMic,
  subDrop, boom808, technoRumble, gabber, clickBeater, tapeThud, boomBap, deepHouse, fmPunch, trapSlide]);
