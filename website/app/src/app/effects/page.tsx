// SPDX-License-Identifier: MIT
import PresetGrid from "../PresetGrid";

export const metadata = {
  title: "Effects",
  description: "Reverbs, delays, modulation and other effects you can try in your browser, with nothing to install.",
};

export default function EffectsPage() {
  return (
    <>
      <h1>Effects</h1>
      <p>Every effect is a cell preset: audio in, audio out. In Ableton Live it loads into Bleep FX; here it opens in Bleep Play.</p>
      <PresetGrid role="effect" />
    </>
  );
}
