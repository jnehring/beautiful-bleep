// SPDX-License-Identifier: MIT
import PresetGrid from "../PresetGrid";

export const metadata = {
  title: "Instruments",
  description: "Synthesizers, drums and generative instruments that play in your browser, with nothing to install.",
};

export default function InstrumentsPage() {
  return (
    <>
      <h1>Instruments</h1>
      <p>Every instrument is a cell preset: MIDI in, audio out. In Ableton Live it loads into Bleep Instrument; here it opens in Bleep Play.</p>
      <PresetGrid role="instrument" />
    </>
  );
}
