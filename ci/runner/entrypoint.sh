#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Registers a runner that takes one job and is gone (--ephemeral); docker compose then starts the next container.
set -euo pipefail
: "${REPO:?REPO is owner/name of the repository}" "${GITHUB_PAT:?GITHUB_PAT is a token that may administer this repository's runners}"

token=$(curl -fsS -X POST -H "Authorization: Bearer ${GITHUB_PAT}" -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/${REPO}/actions/runners/registration-token" | jq -er .token)
./config.sh --url "https://github.com/${REPO}" --token "$token" --name "bleep-build-$(hostname)" --labels bleep-build \
    --ephemeral --unattended --replace --work /tmp/work
# The jobs run in this environment: they must not see the token that can register runners.
unset GITHUB_PAT token
exec ./run.sh
