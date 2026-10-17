// SPDX-License-Identifier: MIT
// A list of factory presets with a "Play it" button each, grouped by category (the pages Instruments and Effects).
import { playablePresets } from "@/lib/content";

export default function PresetGrid({ role }: { role: "instrument" | "effect" }) {
  const all = playablePresets(role);
  const groups = new Map<string, typeof all>();
  for (const p of all) (groups.get(p.category) ?? groups.set(p.category, []).get(p.category)!).push(p);
  return (
    <>
      <p className="muted">{all.length} to try.{role === "instrument" ? " Play them with your computer keys (A W S E D F …), the piano at the bottom, or a MIDI keyboard. Instruments with several voices need a reasonably fast computer." : " Each effect plays through a looping instrument, so you hear it at once; in Play you can switch to your microphone or an audio file."}</p>
      {[...groups].map(([category, list]) => (
        <section key={category}>
          <h2>{category.replace(/\//g, " › ")}</h2>
          <div className="demo-cards">
            {list.map((p) => (
              <div key={p.name} className="demo-card">
                <h3>{p.name}</h3>
                <p>{p.description}</p>
                <p><a className="play-button" href={`/play/index.html?play=${encodeURIComponent(p.name)}&as=${role}`} target="_blank" rel="noopener">Play it</a>{p.polyphonic && <small className="muted"> polyphonic</small>}</p>
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
