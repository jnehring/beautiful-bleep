# Preset system: plan

Status: plan, not started (waiting for other work to land). Written October 2026.

Goal: one clear model for presets (kind × origin), a preset browser and Library that show it, demo presets with
*Run in Play* on every module page, and "where is my preset used?" for authors.

## 0. Decisions

See also §8 (answers to the open questions) and §9 (web instruments).

- **Presets are copied, never referenced.** A preset that contains another preset holds a full copy. No pinning, no
  "update available", and deleting the original breaks nothing. Fixes in the original don't reach copies; that is accepted.
- **Provenance instead of dependency.** A copy records where it came from (a `credits` list). It is a label for
  attribution and for the author's "used in" view. It is never resolved at load time.
- **Every shared preset is CC-BY 4.0.** No licence choice, no remix toggle. The credits text is editable by the user.
- **Privacy:** using a preset locally reports nothing. Only published presets (their credits) and explicit downloads count.
- No anti-gaming measures for "used in".

## 1. What exists today (so the plan doesn't redo it)

| Kind | Where | Notes |
|---|---|---|
| Cell presets (factory) | `patch/presets/*.mjs` → `factory-presets.json` | `plays` already marks instrument / effect |
| Cell presets (user) | `<app data>/Cells/*.bleepcell` | |
| Module presets | `patch/presets/modules/*.mjs` (76 files) → `module-presets.json` | 10–20 per module, preset bar in the module view |
| Demo boards | `patch/presets/demos/*.mjs` (54 files) → `demo-patches.json` | exactly 5 per advanced module, enforced by build + ctest |
| Projects | `.bleepboard`; web: `/api/projects` | private |
| Library presets | `website/api` (`Preset`, `PresetVersion`), `/api/presets`, `.bleeppreset` | type `patch` or `cell`; licence field; versions; download counts; report/takedown |
| Browser | `patch/board/ui/project-browser.js` | groups: all / mine / library / one per module; origin is `factory` \| `user` \| `library` |

So the "5 demos per module" rule is **already built**. The gaps are below.

## 2. Gaps

1. The browser only shows projects. Cell presets and module presets live in the Add menu and the module preset bar, so
   there is no single place to browse by kind.
2. Origin is called `library`, not `community`, and is not shown as a badge on rows.
3. Module pages on the website mention demos in text only. No list of the five, no *Run in Play*.
4. No provenance: nothing records that a preset was built from another.
5. Licence is a free field (CC0 allowed), versions are exposed in the UI as "update available" (conflicts with copy-model).
6. No way to play an instrument or effect preset on the web (§9).

## 3. Data model changes

Two fields on every preset document (all three file formats: `.bleeppreset`, `.bleepcell`, `.bleepboard`):

```json
"origin": "factory | user | community"          // derived at load time, not trusted from the file
"credits": [
  { "name": "Dub Echo", "author": "janne", "address": "janne/dub-echo", "license": "CC-BY-4.0" }
]
```

- `origin` is computed from where the preset was loaded (bundled → factory, local folder → user, downloaded → community).
  A downloaded preset that the user then edits and saves becomes `user`, with the original in `credits`.
- `credits` is a plain list. `address` is optional and only a lookup key for "used in"; it is never fetched on load.
  Factory presets get `author: "bleep"` with no `address` until they move into the Library (spec `library.md` §6).
- **Where credits are written** (automatic, user can edit afterwards):
  1. A library or factory cell preset is placed on the board → the cell node gets `credits` (same mechanism as `help`,
     which is already copied onto the cell so it survives saving).
  2. *Save as preset…* / *Share…* collects the credits of the cell plus the credits of every cell inside it, deduplicated.
  3. A project saved from the board collects the credits of all its cells.
  4. Opening a library project and saving it as one's own adds that project as a credit.
- Schema: add both fields to `schema/preset`, keep `additionalProperties` rules; the sanitiser keeps `credits` through
  `board::sanitise` (check it doesn't drop unknown cell fields).

## 4. Preset browser

Change `project-browser.js` from "groups" to two filters.

- **Kind rail:** Projects (sub-filter Instrument / Effect / Other, from `plays`), Cells, Module demos (grouped by module),
  Module presets (grouped by module), Favourites.
- **Origin chips:** Factory · Mine · Community, multi-select, with a badge and the author on each row.
- **Context default:** opened from an empty cell slot → Cells; in Bleep Instrument/FX → Cells filtered by `plays`
  (this is what the plugin mode already does); from a module view → that module's presets and demos.
- **Factory presets are read-only.** Editing one and saving gives a user preset with a credit to the original.
- **Community rows** show rating, downloads, "used in N". Selecting one downloads on Load, as today.
- Keep the Add menu and the module preset bar as quick access; they read the same index, so there is one source.
- Web: same UI. "Mine" stays on the account (`/api/projects`).

Implementation: one `presetIndex` module that merges the five sources into `[{kind, origin, name, module?, plays?, credits, load()}]`;
the browser renders from it. Do this first, before any visual change, with the existing groups as the first consumer.

## 5. Module pages and demos

- Website `modules/[slug]`: a *Demo presets* section with the five cards (title, description from the demo, order 1–5, tags),
  each with **Run in Play** and **Open in the app** (`bleep://`).
- Source: `demo-patches.json` filtered by `module`. The module docs' hand-written "Demo patches" text should be generated from
  the same data so it can't drift (today it is hand-written, per `demos/README.md`).
- **Run in Play:** the Play page (`website/app/src/app/board`) loads a demo by name (`?demo=<name>`), starts the transport,
  and installs the module types it needs (Play already does this). Nothing of the user's is touched; it opens a fresh board.
- In the app: module view → *Demos* button → the browser filtered to that module.
- Decision needed: serve `demo-patches.json` statically from the site (simple), or publish the demos as `bleep/<module>-<n>`
  in the Library (what `library.md` §6 plans for factory presets). Start static; the move later only changes the loader.

## 6. Library / store

- **Licence:** fix to `CC-BY-4.0`. Remove the CC0 option from *Share…* and from the API validation; existing CC0 entries keep their value.
- **Versions:** keep `PresetVersion` for the author's own history (re-publishing still creates one). Remove the "update available"
  prompt for installed presets and the "kept as a fork" behaviour in the spec; an installed preset is just a copy.
  Optional later: a passive hint "a newer version exists" on the preset's detail view.
- **Deletion:** `DELETE /api/presets/<id>` stays a real delete for the author. Credits in other presets keep their stored
  text; their `address` just stops resolving.
- **Provenance index (new):**
  - Alembic migration: table `preset_credits(preset_version_id, source_address, source_name, source_author)`; index on `source_address`.
  - On `POST /api/presets`: read `credits` from the uploaded file, write rows. Validate length (max 50 entries, text lengths) and
    that it is plain data.
  - `GET /api/presets/<author>/<slug>/used-in` → public list of *listed* presets whose credits mention this address, plus a count.
    Never includes unlisted or private ones. Also add `used_in` to the metadata response.
  - Site: "Used in N presets" on the detail page; a list on the author's own page; optional notification, off by default.
  - Lookup by `source_address` only matches exact `author/slug`; a renamed or re-created preset loses its links (accepted).
- Reports and takedown: unchanged.

## 7. Order of work

1. **Schema + credits plumbing** (§3): fields, sanitiser, credits written when placing a cell and when saving. Tests: round-trip
   through save/load, nesting dedupes, factory placement adds `bleep`.
2. **`presetIndex` + browser** (§4): no new data, just the new UI. Origin rename `library` → `community` across `project-browser.js`,
   side menu and web.
3. **Licence + versions cleanup** (§6, first two bullets): small API change, spec text in `library.md`.
4. **Provenance index + "used in"** (§6): migration, endpoint, detail page. Needs 1 done and a published preset to test with.
5. **Module page demos + Run in Play** (§5). Independent of 2–4; can go in parallel with them.
6. **Web instruments and effects** (§9): `?preset=` loader, on-screen keyboard, effect input (file / mic / test loop), site pages.

Each step builds on its own; 1 is the only hard prerequisite.

## 8. Decisions on the open questions

- **Instrument / effect presets are prewired projects.** An instrument preset takes MIDI in and sends audio out; an effect takes
  audio in and sends audio out. In the apps this is what the `plays` field and the Bleep Instrument / Bleep FX plugins already
  do (one cell, wired to the host's MIDI or audio). The browser shows them as the *Instrument* and *Effect* groups under
  Projects, derived from `plays`. A user's own project can be marked the same way when its ports match (see §9).
- **5 demos per module: factory modules only.**
- **Run in Play** works without installing anything: Play installs the module types itself, and the demos are factory presets.
- **Missing demos (old §2.6, step 6): dropped.** All presets will be recreated anyway.

## 9. Instrument and effect presets on the web

Play already has what an instrument needs: the computer keyboard and Web MIDI drive the *MIDI In* node, and *Audio Out* plays through
the browser (`patch/web/README.md`). So a web instrument is the plugin's wrapper done in the page:

- **Loading an instrument preset in Play:** build the same wiring the plugin makes (MIDI In → the preset cell, per its `plays.instrument.notes`
  → Audio Out), start the transport, show the preset's panel. The panel is the main view: knobs, keys, nothing else. *Open board* shows the patch.
- **Playing:** on-screen keyboard (new, small: the computer keyboard doesn't suit phones), computer keyboard, Web MIDI devices.
  A "Waiting for MIDI?" hint appears when no device is connected.
- **Effects:** audio in from a file the visitor drops in, or from the microphone (asks permission, off by default; warn about feedback with speakers).
  A built-in test loop (drums, a chord) makes the effect audible in one click.
- **Site:** a *Instruments* and an *Effects* page (or tabs on the Library) listing presets with *Play it* buttons that open Play with
  `?preset=<name>`. Community instruments work the same: Play downloads the preset and installs the modules it needs.
- **Cost / risks:** polyphony and CPU limits in a browser; latency is higher than in a DAW (say so on the page); the audio
  context needs a click to start. Instruments without a panel get a generated one (the build already does that).
- **Order:** a small step 7 after step 5, reusing the `?demo=` loader: `?preset=<name>&as=instrument|effect`.

## 10. Files touched (expected)

`patch/board/ui/project-browser.js`, `side-menu.js`, `library.js`, `board.js`; `patch/engine/Board.cpp` (sanitise keeps `credits`);
`patch/presets/kit.mjs`, `build.mjs`; `website/api/app/models.py`, `schemas.py`, `routers/presets.py`, new migration;
`website/app/src/app/modules/[slug]`, `library/detail`, `board`; `doc/specs/specs.md`, `website/content/developers/modules/library.md`.
