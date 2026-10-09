// SPDX-License-Identifier: MIT
"use client";
import { useEffect, useState } from "react";

/** The board player (static build of patch/web at /play/). Loads on demand:
 *  nothing is fetched until the visitor asks, and the browser is checked first. */
export default function BoardPlayer() {
  const [support, setSupport] = useState<"checking" | "ok" | string>("checking");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // The engine is an AudioWorklet running WebAssembly (with exception handling for the JUCE-based modules).
    const wasmEh = (() => {
      try {
        // (module (func try catch_all end))
        return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 8, 1, 6, 0, 6, 64, 25, 11, 11]));
      } catch {
        return false;
      }
    })();
    if (typeof WebAssembly === "undefined") setSupport("This browser has no WebAssembly.");
    else if (typeof AudioWorkletNode === "undefined") setSupport("This browser has no AudioWorklet. Try a current Chrome, Edge, Firefox or Safari.");
    else if (!wasmEh) setSupport("This browser is too old for the module engine (WebAssembly exception handling). Update it and try again.");
    else setSupport("ok");
  }, []);

  if (support !== "ok") {
    return (
      <div className="board-frame board-placeholder">
        <p>{support === "checking" ? "Checking your browser…" : support}</p>
      </div>
    );
  }
  return (
    <div className="board-frame">
      {!loading && (
        <div className="board-placeholder">
          <button type="button" className="board-start" onClick={() => setLoading(true)}>
            ▶ Load Bleep Board
          </button>
          <p>Loads the editor (about 2 MB). Each module downloads the first time you use it.</p>
        </div>
      )}
      {loading && (
        <>
          {!ready && <div className="board-placeholder board-loading">Loading the board…</div>}
          <iframe
            src="/play/index.html"
            title="Bleep Board"
            allow="autoplay; midi"
            onLoad={() => setReady(true)}
            style={ready ? undefined : { visibility: "hidden", position: "absolute" }}
          />
        </>
      )}
    </div>
  );
}
