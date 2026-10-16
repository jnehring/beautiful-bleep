// SPDX-License-Identifier: MIT
import { modules, modulesByCategory } from "@/lib/content";

export default function Home() {
  return (
    <>
      <section className="hero">
        <h1>Beautiful Bleep: a modular synthesizer you can play anywhere.</h1>
        <p>
          Beautiful Bleep is a digital modular synthesizer. Instead of one fixed instrument, you get small sound building
          blocks (oscillators, filters, envelopes, effects) and connect them with virtual cables to build your own sounds.
          Or skip the patching and play one of the ready-made instruments and effects.
        </p>
        <p>
          It runs as a plugin in Ableton Live, as a standalone app and in your browser, with the same engine and the same
          patches in all three.
        </p>
        <div className="actions">
          <a className="primary" href="/board/">Play in your browser</a>
          <a href="/download/">Download the plugin and app</a>
          <a href="/docs/musicians/overview/">Read the docs</a>
        </div>
      </section>

      <h2>One engine, three places</h2>
      <div className="grid">
        <div className="card"><h3>Plugin</h3><p>VST3 plugins for Ableton Live. <a href="/docs/musicians/start/getting-started/">Install in Live</a>.</p></div>
        <div className="card"><h3>App</h3><p>The board without a DAW, with MIDI and audio links to Live. <a href="/docs/musicians/use/standalone/">Read more</a>.</p></div>
        <div className="card"><h3>Web</h3><p>No install, runs in your browser. <a href="/board/">Play now</a>.</p></div>
      </div>
      <p>
        The same board, modules and project files run in all three, and MIDI, audio and tempo can travel between them.
        See <a href="/docs/musicians/start/ways-to-use/">what works today</a>.
      </p>

      <h2>Modules</h2>
      <p>{modules().length} modules in {modulesByCategory().length} categories, each with a manual, in the <a href="/library/?kind=module">Bleep Library</a>.</p>

      <h2>Where to go next</h2>
      <div className="grid doors">
        <div className="card door">
          <h3><a href="/docs/musicians/overview/">For musicians</a></h3>
          <p>Install, make a first sound, learn to patch, connect plugin, app and browser.</p>
          <ul>
            <li><a href="/board/">Play</a></li>
            <li><a href="/docs/musicians/start/first-sound/">Your first sound</a></li>
            <li><a href="/docs/musicians/learn/first-patch/">Your first patch</a></li>
          </ul>
        </div>
        <div className="card door">
          <h3><a href="/docs/developers/overview/">For developers</a></h3>
          <p>
            The cables run on <strong>Bleep Bus</strong>, an open, MIT-licensed protocol with a C SDK, a conformance suite and a public
            specification. Anyone can build modules.
          </p>
          <ul>
            <li><a href="/docs/developers/bleep-bus/quickstart/">Bleep Bus quickstart</a></li>
            <li><a href="/docs/developers/modules/overview/">Write a module</a></li>
          </ul>
        </div>
      </div>
    </>
  );
}
