# SPDX-License-Identifier: MIT
#
# Builds the static site and serves it with Caddy. The build context is the
# repository root, because the site reads the docs (website/content), module
# metadata (patch/modules/*/module.json), the bus header (spec version) and
# the docs generator (scripts/build-docs.py).
#
#   docker compose -f website/docker-compose.yml up --build

FROM node:22-alpine AS build
RUN apk add --no-cache python3
WORKDIR /repo
COPY website/app/package.json website/app/package-lock.json website/app/
RUN cd website/app && npm ci --no-audit --no-fund
COPY bus/include bus/include
COPY patch/modules patch/modules
COPY scripts scripts
COPY website/content website/content
COPY website/app website/app
RUN cd website/app && npm run build

FROM caddy:2-alpine
COPY website/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/website/app/out /srv
EXPOSE 80
