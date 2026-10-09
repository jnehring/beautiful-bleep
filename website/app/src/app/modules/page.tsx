// SPDX-License-Identifier: MIT
import { CategoryLinks, ModuleCatalog } from "../ModuleCatalog";
import { modules } from "@/lib/content";

export default function Modules() {
  return (
    <>
      <h1>Modules</h1>
      <p>
        {modules().length} modules, in the same categories as the board's Add menu. Every knob is a modulation
        destination; each page is the manual behind the <strong>?</strong> button of the module's window.
      </p>
      <CategoryLinks />
      <ModuleCatalog />
    </>
  );
}
