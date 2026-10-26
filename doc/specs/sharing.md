# Sharing patches

A patch is a project or a cell (a normal cell, an instrument or an effect). Patches are shared through the Bleep Library. They are
private by default; the author decides to publish them.

## 1. Decisions

- Two visibilities only: `private` (default) and `public`. There is no link-only level.
- Every library patch has an immutable public ID (`pid`). URLs use the ID, not `author/slug`, so a rename never breaks a link.
- Every upload asks for a name, a description and a version number (x.y), all required, and says in plain words who will be able to use it. The number is the author's own and unique per patch; links and pages show it (`/library/p/<pid>/1.2`). A plain number in a link is the older sequence number and still works.
- Links are pinned to a version. A link always carries the version it was created for; it never follows "latest".
- A deleted, unpublished or private patch gives the same message to everyone but its author: "This patch is no longer available."

## 2. What exists and what changes

Exists: `Preset` (`type` patch|cell, `author/slug`, `PresetVersion` history, CC-BY-4.0, `credits`), `POST /api/presets`, the file
endpoint, user tokens and the device-code login, `/library/detail`, Bleep Play at `/board/`.

Changes:

| Area | Change |
|---|---|
| `Preset.pid` | New, 10 characters base32, unique, immutable, unguessable (for example `k3x9q2mv7a`). Backfilled by the migration. |
| `Preset.visibility` | New: `private` (default) or `public`. |
| `Preset.state` | Moderation only. `unlisted` becomes `removed` (taken down by an admin); it behaves like private for everyone but admins. |
| Project file | New `library: { pid, version, sha256 }`, set on Share and Update. Absent in a copy of someone else's patch (its origin is in `credits`). |
| Caddy | `/embed/*` may be framed; everything else keeps `X-Frame-Options: DENY`. |

## 3. URLs

| Purpose | URL |
|---|---|
| Library page | `/library/p/<pid>/<version>` |
| Play | `/play/?patch=<pid>&v=<version>` (`/board/` is only the page with the Launch button) |
| Embed | `/embed/?patch=<pid>&v=<version>` |

- The `author/slug` page redirects to the newest version's `/library/p/<pid>/<version>`. `/library/p/<pid>` without a version does the same.
- `v` is required in generated links. Play and the embed treat a missing `v` as the newest version, so hand-written links still work.
- Old versions stay reachable for as long as the patch is public. The library page of an old version shows "A newer version exists" with a link.
- API: `GET /api/patches/<pid>` (metadata and version list) and `GET /api/patches/<pid>/<version>/file`.
  Public patches need no login. Private patches need the author's session or token.
- A cell opens in Play as a prewired project: an instrument cell gets a keyboard and MIDI in, an effect cell an audio input
  (preset-system-plan §9).

## 4. Availability and errors

The API answers `404 {"detail": {"error": "patch_unavailable"}}` when the patch does not exist, was deleted, was unpublished (made private),
was removed by moderation, or is private and the caller is not the author. One answer for all of them: it does not reveal whether a
private patch exists.

The library page, Play and the embed show "This patch is no longer available." with a link to the library. An unknown version of an
existing public patch shows "This version does not exist." with a link to the newest one.

Deleting a patch deletes its versions and files. Credits in other patches keep their stored text; their address stops resolving.

## 5. Board menu: Share (standalone, plugin, web)

One menu in the board's main menu, with the same logic in all three modalities (it lives once in the board UI).

| State | Share | Update in Library | Restore from Library | Links |
|---|---|---|---|---|
| Not signed in | opens sign-in | off | off | off |
| Signed in, not linked | **Share…** | off | off | off |
| Linked, you are the author | off | **Update** | **Restore** | Library / Play / Embed Play |
| Linked, library has a different version | off | Update (warns it overwrites) | **Restore** (highlighted) | same |

- **Share…** — one dialog: title, summary, tags, type (project, cell, instrument, effect), visibility (starts at *Private*). *Public*
  shows the CC-BY-4.0 and credits notice. The first upload is version 1.
- **Update in Library** — uploads a new version of the linked patch. The project's `library.version` moves to it. Earlier links keep
  showing the version they were made for.
- **Restore from Library** — replaces the board with a library version as one undoable edit (no tempo or transport change). A picker
  lists the versions; the default is the newest.
- **Links** — copies a link for the version the project is linked to: *Library*, *Play*, *Embed Play* (iframe snippet). For a private patch
  each shows "Only you can open this until you publish." After an Update, the links change to the new version.
- A project that points to a patch which no longer exists shows "The library patch is gone" and offers *Share…* again (new ID) or
  *Unlink*.
- Sign-in: the web uses the session cookie; standalone and plugin use the device-code flow and store a user token.
- Cells have the same Share, Update and Links entries in the cell's context menu.

The library detail page has the same three link buttons and the snippet generator.

## 6. Embed

```html
<iframe src="https://<site>/embed/?patch=k3x9q2mv7a&v=2" width="720" height="420"
        allow="autoplay; midi; fullscreen" loading="lazy"></iframe>
```

- Public patches only. A third-party iframe does not receive the session cookie, so a private patch shows the "no longer available" message.
- Browsers block audio before a click: the embed starts with a poster and a large Play button, then loads the patch and installs the
  modules from the registry as Play does.
- Minimal chrome: the panel if the patch has one, otherwise the board. A fullscreen button (Fullscreen API) and "Open in Bleep Play"
  (the Play link of the same version).
- The embed makes no authenticated requests. Modules run in the existing sandbox. The file endpoint is rate limited.
- Caddy: `frame-ancestors *` for `/embed/*` only.

## 7. Built, and not yet

Built: the migration and `/api/patches/<pid>[/<version>/file]`; `POST /api/presets` with `pid` (update) and `visibility`; the account page
(Make public / Make private); `/library/p/<pid>/<version>` (Caddy rewrite to `/library/detail/`); `/play/?patch=&v=`; `/embed/`
(`website/app/public/embed`); the Share menu in the bar (standalone, web) and the same entries in the side menu (plugins); the project's
`library` link in project files.

Not yet:
- Restore is not highlighted when the library has a different version (dropped); Update asks before it uploads over a newer one.
- The native menu bar (standalone) cannot follow the selection, so its cell entries are always on and say "Select a cell…" when there is none.
- The embed asks for the Play button and then Bleep Play's own *Start audio*.
- A library patch opened by its author in Play is a copy, not linked; the author uses the project they shared.

## 8. Cells

- A cell is shared from its context menu (*Share cell…*, or *Update cell in Library…* once linked) or from the Share menu, whose second
  group acts on the selected cell, or the open one if nothing is selected. Both use the same functions as projects (`account.js`).
- The cell node carries the link (`library: {pid, version, label, sha256}`); the cell's file and the project file hold none, and a
  placed copy is not linked.
- *Restore cell* adds the chosen version as a new cell beside the old one; the old cell stays.
- A cell link opens in Play: a cell that says what it plays (`plays`) is wired as an instrument or effect, any other cell is put on a
  board of its own.

## 9. Order of work

1. Migration (`pid`, `visibility`, `state` rename), `/api/patches/...`, the `patch_unavailable` answer, tests.
2. `?patch=&v=` loader in Play and `/library/p/<pid>/<version>`; the error pages.
3. `library` link in the project file; the Share menu on the web, then the device-code flow in standalone and plugin.
4. `/embed/`, the Caddy route and the snippet generator.
