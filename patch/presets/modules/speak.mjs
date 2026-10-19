// SPDX-License-Identifier: MIT
// Speak (speak): factory presets. The text is each preset's data.
export default [
  ["Hello World", { speed: 6 }, "A greeting, loosely.", { text: "h e l 'o . w 'er l d ." }],
  ["Robot Choir", { speed: 2, intonation: 0, glide: 0.8, coarse: -5 }, "Sustained vowels on one note: a mechanical choir.", { text: "'a ee oo o ae uh" }],
  ["Mumble", { speed: 10, glide: 0.9, breath: 0.3 }, "A blurred, low conversation.", { text: "m uh m uh n ng uh m ." }],
  ["Hat Talk", { speed: 16, glide: 0.1, level: 0.5 }, "Hisses and stops as percussion.", { text: "t k t ch . sh t k t s ." }],
  ["Giant", { speed: 3, formant: -8, coarse: -24 }, "Formants down: a huge, slow voice.", { text: "'oo 'a oo 'o ." }],
  ["Child", { speed: 9, formant: 7, coarse: 7 }, "Formants and pitch up: a small voice.", { text: "'ee ee 'a ae 'o ." }],
  ["Whisper", { speed: 7, breath: 1, level: 0.5, intonation: 0.2 }, "All breath and little voice.", { text: "sh 'ee s h . th 'a s" }],
  ["Vowel Walk", { speed: 4, intonation: 0, glide: 1 }, "Every vowel in turn: a sweeping formant tune.", { text: "a e i o u ee oo ae uh er" }],
  ["Nasal Hum", { speed: 3, coarse: -5, intonation: 0 }, "Long nasals and open vowels.", { text: "m: 'o n: 'a ng: m: ." }],
  ["Stutter", { speed: 14, glide: 0.2, intonation: 0.8 }, "Plosive stutters into a rising vowel.", { text: "b'a b'a b'a d'o d'o k'ee ." }],
  ["Spoken Bass", { speed: 6, coarse: -24, glide: 0.4 }, "A low, pulsing talk: layer it with a bass.", { text: "w'o w'o l'a m'a ." }],
  ["Yes No", { speed: 5, intonation: 0.9 }, "Two short words with a lift at the end.", { text: "y 'e s . n 'o ." }],
  ["Step Words", { mode: "Step", speed: 8, intonation: 0 }, "Step mode: send gates into Go to play one sound at a time.", { text: "'a 'e 'i 'o 'u l m n" }],
];
