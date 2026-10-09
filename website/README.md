# Bleep Patch website

Homepage and documentation. `content/` holds all docs as small Markdown files,
split into two separate documentations: `musicians/` and `developers/`
(the spec lives in `developers/spec/<version>/`). `app/` is a
static Next.js site that renders them.

```bash
cd website/app
npm install
npm run dev      # http://localhost:3000; regenerates public/docs + llms.txt first
npm run build    # static export to app/out/
```

With Docker (one container: the static export served by Caddy):

```bash
docker compose -f website/docker-compose.yml up --build -d    # http://localhost:8080
docker compose -f website/docker-compose.yml down
```

Set `BLEEP_SITE_PORT` to use another port. The build context is the repository
root, because the site reads `website/content`, `patch/modules/*/module.json`,
`bus/include` and `scripts/`.

The module manuals are the board's own docs (`patch/modules/*/doc/*.md`, with
their screenshots); the site shows one page per doc, grouped by the board's
categories (read from `patch/board/ui/demo-types.json`). A module appears once
its doc is written.

`npm run docs` runs `scripts/build-docs.py`, which also writes the single-file
versions (`/docs/api-reference-full.md`, …, versioned under `/docs/v0.1/`; the module
manuals as `/docs/modules-<category>-full.md`) and `/llms.txt`.

Later the service moves into the Brilliant Bleep site's Compose stack as its
own section or subdomain. That decision is still open.
