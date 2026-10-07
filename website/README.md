# Bleep Patch website

Homepage and documentation. `content/` holds all docs as small Markdown files,
split by audience (`users/`, `developers/`, `spec/<version>/`). `app/` is a
static Next.js site that renders them.

```bash
cd website/app
npm install
npm run dev      # http://localhost:3000; regenerates public/docs + llms.txt first
npm run build    # static export to app/out/
```

`npm run docs` runs `tools/build_docs.py`, which also writes the single-file
versions (`/docs/api-reference-full.md`, …, versioned under `/docs/v0.1/`) and
`/llms.txt`.

Deployment will sit in the Brilliant Bleep site stack (Caddy, Docker
Compose) as its own section or subdomain. That decision is still open.
