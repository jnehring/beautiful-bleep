// SPDX-License-Identifier: MIT
/* eslint-disable @next/next/no-img-element -- the screenshots come from the registry's own host, as they are */
const GLYPH: Record<string, string> = { plugin: "⏻", module: "▦", preset: "♫" };

/** The screenshot of a library entry, or a placeholder in the colour of its kind when it has none. */
export function LibraryImage({ kind, title, src, large = false }: { kind: string; title: string; src: string | null; large?: boolean }) {
  return (
    <span className={`library-image${large ? " large" : ""}`}>
      {src ? <img src={src} alt={`${title} screenshot`} loading="lazy" /> : (
        <span className={`placeholder placeholder-${kind}`} role="img" aria-label={`${title}, no screenshot yet`}>
          <span aria-hidden="true">{GLYPH[kind] ?? "◇"}</span>
        </span>
      )}
    </span>
  );
}
