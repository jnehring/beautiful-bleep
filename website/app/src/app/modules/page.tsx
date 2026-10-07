// SPDX-License-Identifier: MIT
import { modules } from "@/lib/content";

export default function Modules() {
  return (
    <>
      <h1>Modules</h1>
      <div className="grid">
        {modules().map((m) => (
          <a key={m.slug} className="card" href={`/modules/${m.slug}/`} style={{ borderTop: `4px solid ${m.colour}`, textDecoration: "none", color: "inherit" }}>
            <h3>{m.name}</h3>
            <div>{m.tagline}</div>
          </a>
        ))}
      </div>
    </>
  );
}
