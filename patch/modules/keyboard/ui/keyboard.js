// SPDX-License-Identifier: GPL-3.0-or-later
// Keyboard view (doc/specs/modules/keyboard.md §5): three octaves of keys to
// play with the mouse or a finger (drag for a glissando), or with the
// computer keyboard while the keys have focus (A W S E D … like a piano,
// Z/X octave). Hold latches keys. Notes go to the engine with api.perform:
// they're played, not saved.
(function () {
  "use strict";
  const OCTAVES = 3, KEYS = OCTAVES * 12 + 1, WHITE_W = 32, BLACK_W = 20;
  const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const IS_BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];
  // Physical keys (layout-independent), semitones above the middle C shown.
  const CODES = { KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9,
                  KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17 };
  const mod = (a, m) => ((a % m) + m) % m;
  const noteName = (n) => NAMES[mod(n, 12)] + (Math.floor(n / 12) - 1);

  function setting(view, id) {
    const p = view.type.params.find((x) => x.id === id);
    const v = view.node.params[id] ?? p.default;
    return Math.round(p.min + v * (p.max - p.min));
  }
  const lowest = (view) => 48 + 12 * setting(view, "octave");  // C3 at Octave 0
  const hold = (view) => setting(view, "hold") === 1;

  // ---- notes: who holds what --------------------------------------------
  // kb.sources: note → Set of sources ("mouse", a key code, "hold"). A note
  // plays while any source holds it.
  function press(view, note, source) {
    const kb = view.kb;
    if (note < 0 || note > 127) return;
    if (hold(view) && source === "mouse") {  // Hold: a click latches or frees the key
      const s = kb.sources.get(note);
      if (s && s.has("hold")) return release(view, note, "hold");
      source = "hold";
    }
    let s = kb.sources.get(note);
    if (!s) kb.sources.set(note, (s = new Set()));
    const first = s.size === 0;
    s.add(source);
    if (first) view.api.perform("on", note);
    paint(view);
  }
  function release(view, note, source) {
    const s = view.kb.sources.get(note);
    if (!s || !s.delete(source)) return;
    if (s.size === 0) {
      view.kb.sources.delete(note);
      view.api.perform("off", note);
    }
    paint(view);
  }
  function releaseAll(view) {
    view.kb.sources.clear();
    view.kb.codes.clear();
    view.kb.mouse = null;
    view.api.perform("allOff");
    paint(view);
  }

  // ---- drawing -------------------------------------------------------------
  function build(view) {
    const kb = view.kb;
    kb.keys.innerHTML = "";
    kb.els = new Map();
    const base = lowest(view);
    let x = 0;
    for (let i = 0; i < KEYS; i++) {
      const n = base + i, black = IS_BLACK[mod(n, 12)];
      const k = document.createElement("div");
      k.className = black ? "kb-b" : "kb-w";
      k.dataset.note = n;
      if (black) k.style.left = x - BLACK_W / 2 + "px";
      else {
        k.style.left = x + "px";
        x += WHITE_W;
        if (mod(n, 12) === 0) {
          const label = document.createElement("span");
          label.textContent = noteName(n);
          k.appendChild(label);
        }
      }
      kb.els.set(n, k);
      kb.keys.appendChild(k);
    }
    kb.keys.style.width = x + "px";
    kb.built = base;
    kb.range.textContent = noteName(base) + " – " + noteName(base + KEYS - 1);
    paint(view);
  }
  function paint(view) {
    const kb = view.kb;
    if (!kb) return;
    if (kb.built !== lowest(view)) return build(view);
    for (const [n, k] of kb.els) {
      k.classList.toggle("down", kb.sources.has(n));
      k.classList.toggle("held", !!(kb.sources.get(n) && kb.sources.get(n).has("hold")));
      k.classList.toggle("active", n === kb.active);
    }
    kb.holdBtn.classList.toggle("on", hold(view));
  }

  BleepViews.register("keyboard", {
    partNames: ["Keys"],
    layout: [
      { title: "Play", params: ["octave", "hold", "priority"] },
      { title: "Touch", params: ["velocity", "glide"] },
    ],
    template:
      "<style>" +
      ".kb{display:flex;flex-direction:column;gap:6px;flex:1 1 100%}" +
      ".kb-bar{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)}" +
      ".kb-bar button{background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:6px;" +
      "padding:2px 9px;font:inherit;cursor:pointer}" +
      ".kb-bar button.on{background:var(--accent);border-color:var(--accent);color:#0d1014}" +
      ".kb-bar .sp{flex:1}" +
      ".kb-keys{position:relative;height:130px;margin:0 auto;touch-action:none;user-select:none;outline:none;" +
      "border-radius:4px}" +
      ".kb-keys:focus-visible{box-shadow:0 0 0 2px var(--accent)}" +
      ".kb-keys div{position:absolute;top:0;box-sizing:border-box;border:1px solid var(--line);border-radius:0 0 4px 4px}" +
      ".kb-w{width:32px;height:130px;background:linear-gradient(#f4f6f9,#d8dee6)}" +
      ".kb-w span{position:absolute;bottom:4px;left:0;right:0;text-align:center;font-size:10px;color:#5b6573}" +
      ".kb-b{width:20px;height:78px;background:linear-gradient(#2a303a,#0f1217);z-index:1}" +
      ".kb-keys .down{background:var(--accent);box-shadow:0 0 14px var(--accent),inset 0 -10px 18px rgba(255,255,255,.35)}" +
      ".kb-keys .kb-w.down{z-index:0}" +
      ".kb-keys .kb-b.down{box-shadow:0 0 14px var(--accent)}" +
      ".kb-keys .held{box-shadow:inset 0 -5px 0 var(--text)}" +
      ".kb-keys .active{border-color:var(--text);border-width:2px}" +
      ".kb-help{font-size:10px;color:var(--muted)}" +
      "</style>" +
      '<div class="kb"><div class="kb-bar"><button class="kb-down" title="Octave down (Z)">‹</button>' +
      '<span class="kb-range"></span><button class="kb-up" title="Octave up (X)">›</button><span class="sp"></span>' +
      '<button class="kb-hold" title="Latch keys: a click starts a note, another click ends it">Hold</button>' +
      '<button class="kb-panic" title="End every note">All off</button></div>' +
      '<div class="kb-keys" tabindex="0"></div>' +
      '<div class="kb-help">Click the keys, then play with A W S E D F T G … · Z / X octave</div></div>',
    afterBuild(view, el) {
      const keys = el.querySelector(".kb-keys");
      const kb = (view.kb = {
        keys, range: el.querySelector(".kb-range"), holdBtn: el.querySelector(".kb-hold"),
        sources: new Map(), codes: new Map(), mouse: null, active: -1, built: null, wasHold: hold(view),
      });
      const setOctave = (d) => {
        const p = view.type.params.find((x) => x.id === "octave");
        const v = Math.min(p.max, Math.max(p.min, setting(view, "octave") + d));
        view.api.beginGesture();
        view.node.params.octave = (v - p.min) / (p.max - p.min);
        view.api.setParam("octave", view.node.params.octave);
        const s = view.settings.get("octave");
        if (s) s.draw();
        paint(view);
      };
      el.querySelector(".kb-down").addEventListener("click", () => setOctave(-1));
      el.querySelector(".kb-up").addEventListener("click", () => setOctave(1));
      kb.holdBtn.addEventListener("click", () => {
        view.api.beginGesture();
        view.node.params.hold = hold(view) ? 0 : 1;
        view.api.setParam("hold", view.node.params.hold);
        const s = view.settings.get("hold");
        if (s) s.draw();
        checkHold(view);
      });
      el.querySelector(".kb-panic").addEventListener("click", () => releaseAll(view));

      // Mouse and touch: press, drag across keys for a glissando.
      const noteAt = (e) => {
        const t = document.elementFromPoint(e.clientX, e.clientY);
        const k = t && t.closest && t.closest(".kb-keys > div");
        return k ? parseInt(k.dataset.note, 10) : null;
      };
      keys.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        keys.focus();
        keys.setPointerCapture(e.pointerId);
        const n = noteAt(e);
        kb.mouse = n;
        if (n !== null) press(view, n, "mouse");
      });
      keys.addEventListener("pointermove", (e) => {
        if (kb.mouse === undefined || kb.mouse === null || hold(view)) return;
        const n = noteAt(e);
        if (n === null || n === kb.mouse) return;
        release(view, kb.mouse, "mouse");
        kb.mouse = n;
        press(view, n, "mouse");
      });
      const up = () => {
        if (kb.mouse !== null && kb.mouse !== undefined) release(view, kb.mouse, "mouse");
        kb.mouse = null;
      };
      keys.addEventListener("pointerup", up);
      keys.addEventListener("pointercancel", up);

      // Computer keyboard, while the keys have focus.
      keys.addEventListener("keydown", (e) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.code === "KeyZ" || e.code === "KeyX") {
          e.preventDefault(); e.stopPropagation();
          if (!e.repeat) setOctave(e.code === "KeyZ" ? -1 : 1);
          return;
        }
        if (!(e.code in CODES)) return;
        e.preventDefault(); e.stopPropagation();
        if (e.repeat || kb.codes.has(e.code)) return;
        const n = lowest(view) + 12 + CODES[e.code];
        kb.codes.set(e.code, n);  // remembered: the octave may change before keyup
        press(view, n, e.code);
      });
      keys.addEventListener("keyup", (e) => {
        const n = kb.codes.get(e.code);
        if (n === undefined) return;
        e.preventDefault(); e.stopPropagation();
        kb.codes.delete(e.code);
        release(view, n, e.code);
      });
      keys.addEventListener("blur", () => {  // keyups go elsewhere now
        for (const [code, n] of kb.codes) release(view, n, code);
        kb.codes.clear();
      });
      build(view);
    },
    onState(st, view) {
      if (!view.kb) return;
      view.kb.active = st && typeof st.active === "number" ? st.active : -1;
      checkHold(view);
      paint(view);
    },
    onRefresh: (view) => { checkHold(view); paint(view); },
  });

  /// Hold switched off (button, setting, undo): latched notes end.
  function checkHold(view) {
    const kb = view.kb, now = hold(view);
    if (kb.wasHold && !now)
      for (const [n, s] of [...kb.sources]) if (s.has("hold")) release(view, n, "hold");
    kb.wasHold = now;
    paint(view);
  }
})();
