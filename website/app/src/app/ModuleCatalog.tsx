// SPDX-License-Identifier: MIT
import { modulesByCategory } from "@/lib/content";

/** Links to the categories' sections on /modules/. */
export function CategoryLinks({ base = "" }: { base?: string }) {
  return (
    <nav className="chips" aria-label="Module categories">
      {modulesByCategory().map((g) => (
        <a key={g.slug} href={`${base}#${g.slug}`}>{g.title} <span>{g.modules.length}</span></a>
      ))}
    </nav>
  );
}

/** Every module, one section per category (the board's Add menu order). */
export function ModuleCatalog() {
  return (
    <>
      {modulesByCategory().map((g) => (
        <section key={g.slug} id={g.slug} className="category">
          <h2>{g.title}</h2>
          <div className="grid">
            {g.modules.map((m) => (
              <a key={m.slug} className="card" href={`/modules/${m.slug}/`} style={{ borderTop: `4px solid ${m.colour}`, textDecoration: "none", color: "inherit" }}>
                <h3>{m.name}</h3>
                <div>{m.tagline}</div>
              </a>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
