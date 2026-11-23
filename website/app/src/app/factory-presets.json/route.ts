// SPDX-License-Identifier: MIT
// The factory instruments and effects (they ship with Bleep and open in Bleep Play), generated at build time (static export) and
// fetched by the Library's Instruments and Effects filters.
import { playablePresets } from "@/lib/content";

export const dynamic = "force-static";

export function GET() {
  return Response.json(playablePresets());
}
