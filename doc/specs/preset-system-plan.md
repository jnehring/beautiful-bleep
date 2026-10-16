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
5. **Module page demos + Run in Play** (§5), plus the generated sections and the CI check from *Module documentation*. Independent of 2–4; can go in parallel with them.
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

## Tempo

A project stores its `tempo`; cell presets have none. In **plugin mode** (Bleep Board, Instrument, FX, Panel in a DAW) the tempo
always follows the host: loading a project or preset never sets it, whatever the file says, and the file's `tempo` is ignored.
In the standalone app and in Play, loading a project or demo sets the tempo from the file (`0` or missing keeps the current one).
Check in step 2 how `loadPatch` treats `tempo` in plugin mode today and make it match.

## Documentation page

Cell presets already have `help` (`{text, images?}`, required for factory presets, shown by the "?" on a placed cell, copied onto the
cell so it survives saving). Generalise it:

- **One field, `docs`, on projects and cells** (replaces `help`; the loader reads old `help` as `docs`). Optional for user and community
  presets, required for every factory preset (build fails without it, as for `help` today). It is copied with the preset, like credits,
  and the user can edit or clear it.
- **Format:** a small Markdown subset: paragraphs, headings, lists, links to modules (`module:filter`), images from the preset's own files.
  Suggested sections: what it is, how to play it, what to patch where, one tip.
- **Where the user sees it:**
  1. **Preset browser:** a detail pane next to the list with the docs, the description, credits and *Load*. Rows with docs show a "?" icon.
     Reading before loading is the main use.
  2. **On the board:** the "?" on a placed cell (exists); for a loaded project, *Project info* in the side menu (docs plus credits).
     A factory project shows its docs once on load, with *Don't show again*.
  3. **Plugin windows (Instrument, FX):** a "?" button on the panel opens the preset's docs.
  4. **Website:** the Library detail page for community presets; the module page for the five demos (each card links to its docs);
     Play shows an info button, and `?preset=` / `?demo=` can open the docs first.
  5. **Help search:** docs are added to `help-search.json`, so searching help finds them.
- **Editing:** *Edit documentation…* on a cell or the project (user presets); *Share…* publishes it with the preset.
- **Writing (factory):** Markdown files, `patch/presets/docs/<preset slug>.md`, with images in `patch/presets/docs/img/`. `build.mjs` reads
  the file by preset name, checks it (the rules below, every image exists, alt text present) and puts the result into the preset's `docs`.
  Today's inline `help` text moves into these files. The module docs under `doc/<type>.md` stay as they are.
- **Writing (users):** *Edit documentation…* opens a Markdown editor with a live preview and an *Add image…* button (file picker, paste,
  drag and drop). It writes `docs` into the user preset or project.

### Format and images

```json
"docs": {
  "markdown": "# Dub Echo\n\nWhat it is…\n\n![The feedback path](img:feedback)\n",
  "images": { "feedback": { "mime": "image/webp", "alt": "Feedback path", "data": "<base64>" } }
}
```

- **Markdown subset:** headings, paragraphs, bold/italic, lists, tables, code, links, images. **No raw HTML.** Links: `module:<slug>` (opens that
  module's docs), `preset:<author>/<slug>`, or `https://` (opens in the system browser after a confirm in the apps). Images only as `img:<key>`.
- **Images are embedded, not linked.** A preset is pure data (`library.md` §6), a link would let an author track viewers, and a copy
  must stay complete offline. A copied preset carries its images.
- **Limits (users and community):** PNG, JPEG or WebP; the editor downscales to 1200 px wide and re-encodes to WebP; at most 6 images, 1 MB for
  all images together; the markdown at most 20 000 characters. The API re-checks all of it on publish and rejects anything else. Alt text is required.
- **Factory images:** stay files (served flat from `patch/board/ui/`, as today) and are referenced the same way; the renderer resolves
  `img:<key>` from the embedded images first, then the served files. This keeps `factory-presets.json` small.
- **Rendering:** one small renderer shared by the board, the plugin window and the website (escapes everything, supports exactly the
  subset above). Not a full Markdown library, so nothing unexpected can run.
- **Moderation:** *Report* already covers presets; add the docs and images to what an admin sees. A takedown hides the docs with the preset.
- **Credits and docs are separate:** editing docs never touches `credits`.

## Module documentation (factory)

Every factory module already has a manual: `patch/modules/<folder>/doc/<type>.md` plus a screenshot `<type>.png` (made by
`scripts/docs/module-screenshots.py`). It is shown behind the "?" in the module view, on the website (`/modules/<slug>`, via
`website/app/src/lib/content.ts`) and in the single-file docs (`scripts/docs/build-docs.py`, `build-help-index.py`). Today the
outline is by convention (Introduction, How does it work?, How to use it?, Demo patches, Reference with Knobs / Settings / Inputs /
Outputs) and the *Demo patches* table is written by hand. The plan:

- **Required for every factory module,** and the same outline for all, checked by CI. A check script (extend `build-docs.py --check`)
  fails on: a missing file, a missing section, sections out of order, no screenshot, an image without alt text, or a link to a module that doesn't exist.
- **Two generated sections, so they can't drift** from the presets (which will be recreated):
  - *Demo patches* is generated from `demo-patches.json` (the five: name, description, order).
  - *Presets* (new) is generated from `module-presets.json` (name and description of the 10–20 module presets).
  Both sit between markers (`<!-- generated:demos -->` … `<!-- /generated -->`); the build rewrites the inside, the check fails if
  it is stale, and nobody edits it by hand. An advanced module with no demos shows no demo section; Sampler is the known exception.
- **Reference tables checked against `module.json` and the node definition** (`build.mjs --reference` already lists every knob with its
  range and default). Start with a check that fails on a mismatch; generate the tables later if the check is too noisy.
- **Where each section leads:**
  - App, module view "?" : demo rows have a *Load* button (opens the browser on that demo); preset rows have *Apply* (sets the knobs on the node being viewed).
  - Website module page: demo cards with **Run in Play** (see "Module pages and demos"); presets listed without buttons.
  - Preset docs link back with `module:<slug>`; module docs link to demos with `preset:bleep/<name>` once factory presets live in the Library.
- **Images:** the generated `<type>.png` screenshot stays first. Other images are allowed (diagrams, signal flow), as PNG/WebP next to the
  doc, alt text required, each at most 300 KB, at most 6 per module. They are copied to `/modules/<slug>/` as today.
- **One renderer.** The module docs use tables, so add **tables** to the shared Markdown subset (see Format and images). The board, plugin
  windows and website then render module docs and preset docs the same way; the website keeps its build-time HTML for SEO.
- **Third-party library modules:** a doc stays optional (`module.json` `doc`), but modules with one get a badge in the Library, and the
  generated demo/preset sections work for them too if they ship presets.

## Samples in presets

Presets and projects are copies, so they take the audio their modules use along (library.md §6 has the full description).

- **Format:** an optional `media` map next to `nodes`: `{ "<16 hex>.wav": { name, data: base64 } }`. Inline in the preset, not a shared
  store: media ids are a 64-bit FNV hash of the file, so a store shared by all authors would let one file shadow another.
- **Which files:** every string in a node's `data` that looks like a media id (`bleep-media.js` `ids()`); no module needs to declare it.
- **Saving:** *Save as preset*, *Save to My Projects* and download attach the files (native `readMedia`); a file that cannot be read is left
  out with a note. **Loading or placing:** the files are imported first (native `importMedia`); importing twice stores one file.
- **Sharing:** up to 8 files, 5 MB together, WAV only; the API checks header and size (422 / 413). The 512 KB limit is for the patch alone.
- **Not in v1:** credits for samples (the preset's CC BY 4.0 licence covers its audio; the terms say publishers must have the right to
  share it), Bleep Play (no media folder in the browser: it needs a store in IndexedDB or memory in the wasm host), the Instrument and FX
  plugins' cell presets (loaded natively), deduplication of the same sample across presets in the bucket.
- **Cost:** user presets with audio make the preset lists bigger (every list call reads them). Watch it; move the audio to separate files
  next to the preset if it hurts.

## 9. Instrument and effect presets on the web

Play already has what an instrument needs: the computer keyboard and Web MIDI drive the *MIDI In* node, and *Audio Out* plays through
the browser (`patch/web/README.md`). A web instrument is the plugin's wrapper done in the page.

**Built (step 6)**
- `/play/index.html?play=<factory preset>&as=instrument|effect` ([board.js](../../patch/board/ui/board.js) `playCell`) replaces the board with
  the preset wired as the plugins wire it, reusing the board's own ports: an instrument takes MIDI In (the jacks `plays.instrument.notes`
  names: trigger, velocity, pitch, gate, notes), an effect takes a looping instrument as its source (`&source=<preset>`, default the first
  self-playing one). [play-wrap.js](../../patch/board/ui/play-wrap.js) decides what can be played and which cables it needs
  (`patch/web/test/play-wrap-test.mjs` runs it over every factory preset). The preset's panel comes with it.
- [play-keys.js](../../patch/board/ui/play-keys.js): an on-screen piano (two octaves, octave buttons, touch and mouse) under an instrument.
- Pages `/instruments/` and `/effects/` list the factory presets with *Play it* (static, from `factory-presets.json`); the Play page links to them.
- Today 68 of 138 instruments and all 21 effects can be played; the other 70 instruments need voices.

**Not built**
- **Voices (the big one).** 70 instruments use a Voice Cell, and Play's engine has none (`patch/web/js/graph.js`: "Not ported yet: Voice
  Cells"). It needs the voice allocator and per-voice copies of the cell's modules in the JS graph runner (the counterpart of
  `engine/VoiceCell.cpp`), and a build with the Emscripten SDK to test it.
- **Audio input** for effects (a dropped file, the microphone): `PortNode` has silent `audio-in` outputs; it needs an AudioWorklet input.
  Until then an effect plays through a built-in self-playing instrument.
- **Drum maps:** a preset that maps keys to different jacks (hats: closed, open) plays one sound for every key.
- Choosing the effect's source in the page (only the URL parameter), and `?play=` for community presets (they arrive with step 4's Library work).
- Not checked: any sound. The dev server's engine has no audio, so wiring, ports and the piano were checked in the browser, not by ear.

## 10. Files touched (expected)

`patch/board/ui/project-browser.js`, `side-menu.js`, `library.js`, `board.js`; `patch/engine/Board.cpp` (sanitise keeps `credits`);
`patch/presets/kit.mjs`, `build.mjs`; `website/api/app/models.py`, `schemas.py`, `routers/presets.py`, new migration;
`website/app/src/app/modules/[slug]`, `library/detail`, `board`; `doc/specs/specs.md`, `website/content/developers/modules/library.md`.
