// SPDX-License-Identifier: MIT
"use client";
import { useEffect, useState } from "react";

/** Big "Launch" button: opens the player (static build of patch/web at /play/) in a new window.
 *  The browser is checked first, so a visitor on an unsupported one gets a reason instead of a blank window. */
export default function LaunchButton() {
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const engineOk = (() => {
      try {
        // The engine needs exception handling: (module (func try catch_all end))
        return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 8, 1, 6, 0, 6, 64, 25, 11, 11]));
      } catch {
        return false;
      }
    })();
    if (typeof AudioWorkletNode === "undefined") setProblem("This browser can't run Bleep. Try a current Chrome, Edge, Firefox or Safari.");
    else if (!engineOk) setProblem("This browser is too old to run Bleep. Update it and try again.");
  }, []);

  return (
    <div className="play-launch">
      <a
        className="play-button"
        href="/play/index.html"
        target="_blank"
        rel="noopener"
        onClick={(e) => {
          if (problem) return e.preventDefault();
          e.preventDefault();
          const w = Math.min(1440, screen.availWidth), h = Math.min(900, screen.availHeight);
          window.open("/play/index.html", "bleep-play", `popup=yes,width=${w},height=${h}`) ?? (window.location.href = "/play/index.html");
        }}
        aria-disabled={problem ? "true" : undefined}
      >
        Launch
      </a>
      <p>{problem ?? "Opens in a new window. About 2 MB to load; each module downloads the first time you use it."}</p>
    </div>
  );
}
