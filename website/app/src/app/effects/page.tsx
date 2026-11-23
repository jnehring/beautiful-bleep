// SPDX-License-Identifier: MIT
import { Redirect } from "../Redirect";

export const metadata = { title: "Effects" };

/** The effects are part of the Bleep Library now. */
export default function EffectsPage() {
  return <Redirect to="/library/?kind=effect" />;
}
