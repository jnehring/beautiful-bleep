// SPDX-License-Identifier: MIT
// Button view (doc/specs/modules/button.md §5): a big pad. Press with the mouse,
// a finger, or Space/Enter while the pad has focus. The toggle's state is
// saved in the node's data, so it survives saving the set.
(function () {
  "use strict";
  // The toggle's state comes from the node's data (refresh() brings undo's).
  const on = (view) => !!(view.node.data && view.node.data.on);

  function draw(view) {
    const b = view.button;
    if (!b) return;
    const toggle = Math.round(view.node.params.mode ?? 0) === 1;
    b.pad.classList.toggle("held", b.held);
    b.pad.classList.toggle("on", toggle ? on(view) : b.held);
    b.led.classList.toggle("on", on(view));
    b.label.textContent = toggle ? (on(view) ? "On" : "Off") : b.held ? "Held" : "Press";
  }

  BleepViews.register("button", {
    partNames: ["Pad"],
    side: true,
    layout: [{ title: "Behaviour", params: ["mode"] }],
    template:
      "<style>" +
      ".bt{display:flex;flex-direction:column;align-items:center;gap:8px;flex:1 1 100%}" +
      ".bt-pad{width:100%;height:170px;border-radius:18px;border:2px solid var(--line);background:radial-gradient(circle at 50% 35%,var(--panel-3),var(--panel));" +
      "color:var(--muted);font:inherit;font-size:20px;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;" +
      "touch-action:none;user-select:none;transition:transform .04s,background .08s}" +
      ".bt-pad.on{background:radial-gradient(circle at 50% 40%,color-mix(in srgb,var(--accent) 70%,#fff),var(--accent));border-color:var(--accent);color:#0d1014;" +
      "box-shadow:0 0 36px var(--accent),inset 0 0 28px rgba(255,255,255,.3);animation:bt-pulse 1.6s ease-in-out infinite}" +
      "@keyframes bt-pulse{50%{box-shadow:0 0 54px var(--accent),inset 0 0 36px rgba(255,255,255,.4)}}" +
      ".bt-pad.held{transform:scale(.97)}" +
      ".bt-pad:focus-visible{outline:2px solid var(--accent);outline-offset:3px}" +
      ".bt-row{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted)}" +
      ".bt-led{width:9px;height:9px;border-radius:50%;background:var(--line)}" +
      ".bt-led.on{background:var(--accent);box-shadow:0 0 6px var(--accent)}" +
      "</style>" +
      '<div class="bt"><button class="bt-pad" title="Press (Space or Enter while focused)"></button>' +
      '<div class="bt-row"><span class="bt-led"></span>Toggle</div></div>',
    afterBuild(view, el) {
      const pad = el.querySelector(".bt-pad");
      view.button = { pad, led: el.querySelector(".bt-led"), label: pad, held: false };
      const down = () => {
        if (view.button.held) return;
        view.button.held = true;
        // Every press flips the toggle; the view saves it, the engine plays it.
        const next = !on(view);
        view.node.data = { on: next };
        view.api.setData({ on: next });
        view.api.perform("press", next ? 1 : 0);
        draw(view);
      };
      const up = () => {
        if (!view.button.held) return;
        view.button.held = false;
        view.api.perform("release");
        draw(view);
      };
      pad.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        pad.setPointerCapture(e.pointerId);
        pad.focus();
        down();
      });
      pad.addEventListener("pointerup", up);
      pad.addEventListener("pointercancel", up);
      pad.addEventListener("lostpointercapture", up);
      pad.addEventListener("click", (e) => e.preventDefault());  // no extra press from the keyboard's click
      pad.addEventListener("keydown", (e) => {
        if (e.key !== " " && e.key !== "Enter") return;
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) down();
      });
      pad.addEventListener("keyup", (e) => {
        if (e.key !== " " && e.key !== "Enter") return;
        e.preventDefault();
        e.stopPropagation();
        up();
      });
      pad.addEventListener("blur", up);
      draw(view);
    },
    onState: (st, view) => draw(view),  // Mode may have changed
    onRefresh: draw,
  });
})();
