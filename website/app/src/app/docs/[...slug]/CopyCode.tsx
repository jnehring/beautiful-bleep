// SPDX-License-Identifier: MIT
"use client";
import { useEffect } from "react";

/** Makes the Copy buttons that the docs renderer puts in every code block work (one listener for the page). */
export default function CopyCode() {
  useEffect(() => {
    const timers = new WeakMap<Element, number>();
    const onClick = (e: MouseEvent) => {
      const button = (e.target as Element | null)?.closest?.(".codeblock > button.copy");
      const code = button?.parentElement?.querySelector("pre code");
      if (!button || !code) return;
      const done = (ok: boolean) => {
        button.classList.toggle("done", ok);
        button.setAttribute("title", ok ? "Copied" : "Copy failed: select the code and press Ctrl+C");
        window.clearTimeout(timers.get(button));
        timers.set(button, window.setTimeout(() => { button.classList.remove("done"); button.setAttribute("title", "Copy"); }, 1500));
      };
      const text = code.textContent ?? "";
      // the old way, for a page where the clipboard API is not allowed (an embedded browser, an insecure origin)
      const fallback = () => {
        const area = document.createElement("textarea");
        area.value = text;
        area.style.cssText = "position:fixed;opacity:0";
        document.body.append(area);
        area.select();
        let ok = false;
        try { ok = document.execCommand("copy"); } catch { /* not allowed either */ }
        area.remove();
        done(ok);
      };
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => done(true), fallback);
      else fallback();
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  return null;
}
