// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// play-keys.js — an on-screen piano for Bleep Play, shown while an instrument preset is played on its own (play-wrap.js). The computer
// keyboard and Web MIDI already play the MIDI In node (patch/web/js/bleep-web.js); this adds mouse and touch, for the phone.
//
//   BleepPlayKeys.show(name, route)   the bar with the preset's name and two octaves of keys; hide() removes it. `route` ({on(note), off(note)}):
//     how to play when the page has no BleepWeb (the standalone app presses the keys of a Keyboard module)
// It calls BleepWeb.noteOn(note, velocity) and noteOff(note) when the page has them (Bleep Play); in the dev server it only draws.
(function () {
  "use strict";
  const WHITE = [0, 2, 4, 5, 7, 9, 11], BLACK = { 1: 0, 3: 1, 6: 3, 8: 4, 10: 5 };   // semitone → white key it follows
  const NAMES = ["C", "D", "E", "F", "G", "A", "B"];
  let bar = null, octave = 3, label = null;
  const down = new Map();   // pointer id → note

  const web = () => window.BleepWeb;
  let route = null;   // {on(note), off(note)} when the page has no BleepWeb to play through (the standalone app presses a Keyboard module)
  function on(note) {
    if (route) { route.on(note); return; }
    const w = web();
    if (w && w.keyDown) w.keyDown(note, 0.8); else if (w && w.noteOn) w.noteOn(note, 0.8);
  }
  function off(note) {
    if (route) { route.off(note); return; }
    const w = web();
    if (w && w.keyUp) w.keyUp(note); else if (w && w.noteOff) w.noteOff(note);
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function build() {
    bar = el("div", "pk");
    bar.id = "play-keys";
    const head = el("div", "pk-head");
    label = el("span", "pk-name");
    const down1 = el("button", "pk-oct", "−");
    const up1 = el("button", "pk-oct", "+");
    const oct = el("span", "pk-octave");
    const redraw = () => { oct.textContent = "Octave " + octave; draw(); };
    down1.title = "Octave down"; up1.title = "Octave up";
    down1.addEventListener("click", () => { octave = Math.max(0, octave - 1); redraw(); });
    up1.addEventListener("click", () => { octave = Math.min(7, octave + 1); redraw(); });
    const hint = el("span", "pk-hint", "Computer keys A S D F … play too");
    head.append(label, down1, oct, up1, hint);
    keys = el("div", "pk-keys");
    keys.addEventListener("pointerdown", (e) => {
      const k = e.target.closest("[data-note]");
      if (!k) return;
      e.preventDefault();
      keys.setPointerCapture && keys.setPointerCapture(e.pointerId);
      const note = +k.dataset.note;
      down.set(e.pointerId, note);
      k.classList.add("on");
      on(note);
    });
    const release = (e) => {
      const note = down.get(e.pointerId);
      if (note === undefined) return;
      down.delete(e.pointerId);
      for (const k of keys.querySelectorAll(".on")) if (+k.dataset.note === note) k.classList.remove("on");
      off(note);
    };
    keys.addEventListener("pointerup", release);
    keys.addEventListener("pointercancel", release);
    bar.append(head, keys);
    document.getElementById("main").appendChild(bar);
    redraw();
  }

  let keys = null;
  /// Two octaves from C of the current octave: white keys in a row, black keys over them.
  function draw() {
    keys.innerHTML = "";
    const base = 12 * (octave + 1);
    for (let o = 0; o < 2; o++) {
      WHITE.forEach((semi, i) => {
        const w = el("div", "pk-white");
        w.dataset.note = String(base + 12 * o + semi);
        if (semi === 0) w.appendChild(el("span", "pk-c", "C" + (octave + o)));
        keys.appendChild(w);
      });
    }
    for (let o = 0; o < 2; o++)
      for (const [semi, after] of Object.entries(BLACK)) {
        const b = el("div", "pk-black");
        b.dataset.note = String(base + 12 * o + +semi);
        b.style.left = `calc(${((o * 7 + after + 1) / 14) * 100}% - 0.9%)`;
        keys.appendChild(b);
      }
  }

  window.BleepPlayKeys = {
    show(name, how) {
      route = how || null;
      if (!bar) build();
      label.textContent = name || "";
      bar.hidden = false;
      const source = document.getElementById("play-source");   // an effect's source bar sits at the bottom too: stand above it
      bar.style.bottom = source && !source.hidden ? source.offsetHeight + "px" : "0";
    },
    hide() { if (bar) bar.hidden = true; },
    visible: () => !!bar && !bar.hidden,
    /// The octave of the lowest key (the C that is labelled C<octave>); 3 is where an instrument starts.
    setOctave(o) {
      octave = Math.max(0, Math.min(7, Math.round(o)));
      if (bar) { bar.querySelector(".pk-octave").textContent = "Octave " + octave; draw(); }
    },
  };
})();
