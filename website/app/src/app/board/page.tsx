// SPDX-License-Identifier: MIT
// "Play": instructions plus a launch button for the board running in the visitor's browser.
// The player itself is the static build of patch/web (scripts/build/build-web.sh), served at /play/.
import LaunchButton from "./LaunchButton";

export const metadata = {
  title: "Play",
  description: "Play Bleep in your browser. No install: it runs entirely in your browser and can be connected to Ableton Live and the standalone app.",
};

export default function PlayPage() {
  return (
    <>
      <section className="hero">
        <h1>Play</h1>
        <p>
          Patch and play Bleep right here, with nothing to install. It runs entirely in your browser: no sound
          or patch ever leaves your computer. It can also be connected to Ableton Live and to the standalone app.
        </p>
      </section>
      <LaunchButton />

      <p>Or try an <a href="/instruments/">instrument</a> or an <a href="/effects/">effect</a> on its own.</p>

      <h2>How to use it</h2>
      <ol className="play-steps">
        <li><strong>Launch</strong> opens Bleep in its own window. Click <strong>Start audio</strong> once; browsers only allow sound after a click.</li>
        <li><strong>Play the Keyboard module</strong> with your computer keys (<code>A W S E D F T G Y H U J</code>), or with a MIDI keyboard (Chrome and Edge).</li>
        <li><strong>Patch.</strong> Drag from a jack to another jack to make a cable. Every knob can be a modulation destination.</li>
        <li><strong>Add modules.</strong> Press <kbd>Tab</kbd> (or double-click empty space) and type to search. A module downloads the first time you use it.</li>
        <li><strong>Connect.</strong> Link the browser to Ableton Live or the standalone app to exchange MIDI and audio with them.</li>
      </ol>

      <h2>Good to know</h2>
      <ul className="play-steps">
        <li>Use a current Chrome, Edge, Firefox or Safari. MIDI input needs Chrome or Edge.</li>
        <li>Not available in the browser yet: Voice Cells, Link, audio input and importing audio files.</li>
        <li>Want more? See <a href="/docs/musicians/start/ways-to-use/">the ways to use Bleep</a>.</li>
      </ul>
    </>
  );
}
