// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
//
// bridge-types.js — the board node types the web link adds: Remote Audio and Remote MIDI (doc/specs/bridges.md
// §10.3 `open`: "Bleep Play bridges one of its nodes"). They have the shape of the entries in
// demo-types.json so the engine (graph.js) and the board UI can take them as they are; `port: "remote"`
// makes the engine build them as host-side port nodes.
//
// A node is bound to a channel by `node.remote = <channel key>`: the key the web node opened
// (`openChannel`), or the key of a channel the hub announced (a Live port with Board = Bleep Play, which the board
// mirrors with the ordinary audio-in / audio-out / midi-in / midi-out / instrument port types).

const audio = (id, name) => ({ id, name, type: "audio", bipolar: true });
const control = (id, name) => ({ id, name, type: "control", bipolar: false });

// The same outputs as MIDI In, so a Remote MIDI node plugs in wherever one does.
const midiOutputs = [
  { id: "notes", name: "Notes", type: "notes", bipolar: false },
  { id: "pitch", name: "Pitch", type: "pitch", bipolar: true },
  { id: "gate", name: "Gate", type: "gate", bipolar: false },
  control("velocity", "Velocity"),
  { id: "trigger", name: "Trigger", type: "trigger", bipolar: false },
  control("pressure", "Pressure"), control("bend", "Bend"), control("mod", "Mod"),
];

export const REMOTE_TYPES = [
  { type: "remote-audio", name: "Remote Audio", category: "Ports", colour: "#60a5fa", port: "remote", creatable: true, standaloneOnly: false,
    description: "Audio to and from the Bleep App (and Live through it), over the web link.",
    params: [], inputs: [audio("l", "To app L"), audio("r", "To app R")], outputs: [audio("l", "From app L"), audio("r", "From app R")] },
  { type: "remote-midi", name: "Remote MIDI", category: "Ports", colour: "#60a5fa", port: "remote", creatable: true, standaloneOnly: false,
    description: "Notes to and from the Bleep App (and Live through it), over the web link.",
    params: [], inputs: [{ id: "notes", name: "Notes to app", type: "notes", bipolar: false }], outputs: midiOutputs },
];
