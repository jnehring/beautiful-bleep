# SPDX-License-Identifier: MIT
#
# Builds the static site and serves it with Caddy. The build context is the
# repository root, because the site reads the docs (website/content), module
# metadata (patch/modules/*/module.json, board/ui/demo-types.json for the
# categories), the bus header (spec version) and
# the docs generator (scripts/build-docs.py).
#
#   docker compose -f website/docker-compose.yml up --build

# Bleep Board: every module compiled to its own WebAssembly file, plus the board UI
# and the web engine (scripts/build-web.sh). Served at /play/.
FROM emscripten/emsdk:4.0.10 AS web
WORKDIR /repo
# JUCE in its own layer: cloned once, not on every change under patch/.
RUN git clone --depth 1 --branch 8.0.9 https://github.com/juce-framework/JUCE.git /juce
ENV BLEEP_JUCE_DIR=/juce
COPY patch patch
COPY scripts scripts
RUN scripts/build-web.sh /out

FROM node:22-alpine AS build
RUN apk add --no-cache python3
WORKDIR /repo
COPY website/app/package.json website/app/package-lock.json website/app/
RUN cd website/app && npm ci --no-audit --no-fund
COPY bus/include bus/include
COPY patch/modules patch/modules
COPY patch/board/ui/demo-types.json patch/board/ui/demo-types.json
COPY scripts scripts
COPY website/content website/content
COPY website/app website/app
COPY --from=web /out website/app/public/play
RUN cd website/app && npm run build

FROM caddy:2-alpine
COPY website/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/website/app/out /srv
EXPOSE 80
