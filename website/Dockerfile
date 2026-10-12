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
FROM node:22-alpine AS web
RUN apk add --no-cache bash python3
WORKDIR /repo
COPY patch/board patch/board
COPY patch/common patch/common
COPY patch/modules patch/modules
COPY patch/web patch/web
COPY scripts/build/build-web.sh scripts/build/build-web.sh
RUN scripts/build/build-web.sh --no-modules /out

FROM node:22-alpine AS build
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

FROM caddy:2-alpine
COPY website/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/website/app/out /srv
EXPOSE 80
