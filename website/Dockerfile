# SPDX-License-Identifier: MIT
#
# Builds the static site and serves it with Caddy. The build context is the
# repository root, because the site reads the docs (website/content), module
# metadata (patch/modules/*/module.json, board/ui/demo-types.json for the
# categories), the bus header (spec version) and
# the docs generator (scripts/docs/build-docs.py).
#
#   docker compose -f website/docker-compose.yml up --build

# Bleep Play: the board UI and the web engine (scripts/build/build-web.sh --no-modules), served at
# /play/. The modules (.wasm) are not built here: they are served from a folder mounted into the
# container (website/docker-compose.yml), built once with scripts/build/build-web.sh --modules-only,
# and later come from the registry.
# node:22-alpine
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS web
RUN apk add --no-cache bash python3
WORKDIR /repo
COPY patch/CMakeLists.txt patch/CMakeLists.txt
COPY config/library.json config/library.json
COPY patch/board patch/board
COPY patch/common patch/common
COPY patch/modules patch/modules
COPY patch/web patch/web
# The Bleep Script compiler and editor for the Code node (patch/script): bundled here, copied next to the board by build-web.sh.
COPY patch/script/package.json patch/script/package-lock.json patch/script/bundle.mjs patch/script/
RUN --mount=type=cache,target=/root/.npm cd patch/script && npm ci --no-audit --no-fund
COPY patch/script/compiler patch/script/compiler
COPY patch/script/builtin-modules.mjs patch/script/builtin-modules.txt patch/script/
COPY patch/script/editor patch/script/editor
COPY patch/script/patch patch/script/patch
COPY patch/script/transform patch/script/transform
COPY patch/script/src patch/script/src
COPY patch/script/playground/examples.mjs patch/script/playground/examples.mjs
# the vintage modules' manuals are the help pages of their Code node examples (patch/script/compiler/bundle-entry.mjs)
COPY website/content/developers/bleep-script/vintage-modules website/content/developers/bleep-script/vintage-modules
RUN cd patch/script && node bundle.mjs
COPY scripts/build/build-web.sh scripts/build/build-web.sh
RUN scripts/build/build-web.sh --no-modules /out

# node:22-alpine
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS build
RUN apk add --no-cache python3
WORKDIR /repo
COPY website/app/package.json website/app/package-lock.json website/app/
RUN --mount=type=cache,target=/root/.npm \
    cd website/app && npm ci --no-audit --no-fund
COPY bus/include bus/include
COPY patch/modules patch/modules
COPY patch/board/ui/demo-types.json patch/board/ui/demo-types.json
COPY scripts scripts
COPY website/content website/content
COPY website/app website/app
COPY --from=web /out website/app/public/play
# The Next cache lives outside the image layers, so rebuilds only recompile what changed.
RUN --mount=type=cache,target=/repo/website/app/.next/cache \
    cd website/app && npm run build

# caddy:2-alpine
FROM caddy:2-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f
COPY website/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/website/app/out /srv
EXPOSE 80
