// SPDX-License-Identifier: MIT
import { modules, modulesByCategory } from "@/lib/content";
import { CategoryLinks } from "./ModuleCatalog";

export default function Home() {
  return (
    <>
      <section className="hero">
        <h1>Modular, inside Live.</h1>
        <p>
          Small building blocks (function generators, randomness, utilities, a filter) connected by virtual
          cables across tracks and devices. No extra tracks, no separate environment. Every knob is a
          modulation destination.
        </p>
        <p>
          <a href="/docs/musicians/getting-started/">Get started</a> · <a href="/docs/developers/quickstart/">Build for the bus</a>
        </p>
      </section>
      <h2>Modules</h2>
      <p>{modules().length} modules in {modulesByCategory().length} categories. <a href="/modules/">See them all</a>.</p>
      <CategoryLinks base="/modules/" />
      <h2>Open technology</h2>
      <p>
        The cables run on <strong>Bleep Bus</strong>, an open, MIT-licensed protocol with a C SDK, a conformance
        suite and a public specification. Anyone can build plugins that send or receive bus signals, with no
        permission and no fees.
      </p>
    </>
  );
}
