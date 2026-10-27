# SPDX-License-Identifier: MIT
#
# The build runner of .github/workflows/dev.yml: a GitHub Actions runner with the whole toolchain in the image, so a job needs
# nothing from the server and no access to Docker. Start it with docker-compose.yml (doc/operations/dev-builds.md).
FROM emscripten/emsdk:4.0.10

ARG RUNNER_VERSION=2.321.0
ARG JUCE_VERSION=8.0.9
ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential cmake ninja-build pkg-config ccache git curl jq ca-certificates python3 python3-pip \
        libasound2-dev libx11-dev libxrandr-dev libxinerama-dev libxcursor-dev libfreetype-dev libfontconfig1-dev \
        libgl1-mesa-dev libwebkit2gtk-4.1-dev libcurl4-openssl-dev \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# JUCE once, here: a job does not download it (or anything else it builds with).
RUN git clone --depth 1 --branch ${JUCE_VERSION} https://github.com/juce-framework/JUCE.git /opt/JUCE
ENV BLEEP_JUCE_DIR=/opt/JUCE \
    CCACHE_DIR=/cache/ccache \
    CMAKE_C_COMPILER_LAUNCHER=ccache \
    CMAKE_CXX_COMPILER_LAUNCHER=ccache

RUN useradd --create-home --uid 1001 runner && mkdir -p /cache /home/runner/actions-runner && chown -R runner /cache /home/runner
USER runner
WORKDIR /home/runner/actions-runner
RUN curl -fsSL https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz | tar xz
USER root
RUN ./bin/installdependencies.sh && rm -rf /var/lib/apt/lists/*
COPY entrypoint.sh /entrypoint.sh
RUN chmod 755 /entrypoint.sh
USER runner
ENTRYPOINT ["/entrypoint.sh"]
