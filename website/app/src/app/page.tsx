// SPDX-License-Identifier: MIT
import { modules, modulesByCategory } from "@/lib/content";

export default function Home() {
  return (
    <>
      <section className="hero">
        <h1>Modular sound, wherever you make it.</h1>
        <p>
          One modular engine as a plugin in Ableton Live, as a standalone app and in your browser. Play a
          ready-made instrument or effect, or patch your own with cables between small building blocks. Every knob
          is a modulation destination.
        </p>
        <p>
          <a href="/board/">Play in your browser</a> · <a href="/docs/musicians/overview/">Ways to use Bleep</a> · <a href="/docs/developers/quickstart/">Build for the bus</a>
        </p>
      </section>
      <h2>Three places</h2>
      <div className="grid">
        <div className="card"><h3>Plugin</h3><p>VST3 plugins for Ableton Live. <a href="/docs/musicians/getting-started/">Get started</a>.</p></div>
        <div className="card"><h3>App</h3><p>The board without a DAW, with MIDI and audio links to Live. <a href="/docs/musicians/standalone/">Read more</a>.</p></div>
        <div className="card"><h3>Web</h3><p>No install, runs in your browser. <a href="/board/">Play now</a>.</p></div>
      </div>
      <h2>Three ways to play</h2>
      <div className="grid">
        <div className="card"><h3>Instrument</h3><p>Pick a preset, play it with MIDI.</p></div>
        <div className="card"><h3>Audio effect</h3><p>Pick a preset, send audio through it.</p></div>
        <div className="card"><h3>Full board</h3><p>The whole board: your modules, your cables.</p></div>
      </div>
      <p>
        Instruments and effects are small patches on the same board, so you can open one, change it and cable it to
        others. MIDI, audio and tempo are meant to travel between all three places; see{" "}
        <a href="/docs/musicians/overview/">what works today</a>.
      </p>
      <h2>Modules</h2>
      <p>{modules().length} modules in {modulesByCategory().length} categories, with their manuals, in the <a href="/store/?kind=module">Bleep Store</a>.</p>
      <h2>Open technology</h2>
      <p>
        The cables run on <strong>Bleep Bus</strong>, an open, MIT-licensed protocol with a C SDK, a conformance
        suite and a public specification. Anyone can build plugins that send or receive bus signals, with no
        permission and no fees.
      </p>
    </>
  );
}
