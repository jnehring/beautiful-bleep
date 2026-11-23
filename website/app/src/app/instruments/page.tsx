// SPDX-License-Identifier: MIT
import { Redirect } from "../Redirect";

export const metadata = { title: "Instruments" };

/** The instruments are part of the Bleep Library now. */
export default function InstrumentsPage() {
  return <Redirect to="/library/?kind=instrument" />;
}
