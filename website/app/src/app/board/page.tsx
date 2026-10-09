// SPDX-License-Identifier: MIT
// "Bleep Board": the board running in the visitor's browser. The player itself
// is the static build of patch/web (scripts/build-web.sh), served at /play/.

export const metadata = {
  title: "Bleep Board",
  description: "Play the Bleep Patch board online. It runs completely in your browser: no install, no server.",
};

export default function BoardPage() {
  return (
    <>
      <section className="hero">
        <h1>Bleep Board</h1>
        <p>
          Patch and play the board right here. Everything runs in your browser: the audio engine is WebAssembly
          and no sound or patch ever leaves your computer. Each module is loaded the first time you use it.
        </p>
      </section>
      <div className="board-frame">
        <iframe src="/play/index.html" title="Bleep Board" allow="autoplay; midi" loading="lazy" />
      </div>
      <p className="board-help">
        Click <strong>Start audio</strong>, then play the Keyboard module with your computer keys
        (<code>A W S E D F T G Y H U J</code>) or a MIDI keyboard (Chrome, Edge). Drag from a jack to patch,
        <kbd>Tab</kbd> adds a module. <a href="/play/index.html">Open full screen</a>.
        Some modules (sequencers, quantizers, samplers) are not in the browser yet.
      </p>
    </>
  );
}
