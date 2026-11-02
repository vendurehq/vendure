# Build image for Anthropic's OSS Scanner (https://github.com/anthropics/oss-scanner).
# The scanner builds this with the repository root as the build context, then removes network
# access, so everything the build and tests need must be installed here.
FROM node:22-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    CI=true \
    HUSKY=0

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential ca-certificates git python3 \
    && rm -rf /var/lib/apt/lists/*

# Same Bun version as .github/actions/setup/action.yml
COPY --from=oven/bun:1.3.10-debian /usr/local/bin/bun /usr/local/bin/bun

# scanner contract: the checkout lives inside the image, at /src
COPY --chown=node:node . /src
WORKDIR /src
USER node

# Bun only runs lifecycle scripts for the packages in `trustedDependencies` (root package.json).
# better-sqlite3 and re2 need theirs to build their native modules.
# `bun run build` builds every package, as the CI "build" job does.
RUN bun install --frozen-lockfile && bun run build

# Run the unit tests of @vendure/core as a smoke test, without letting failures abort the build.
# E2E tests default to the in-memory sql.js driver and need no external services:
#   cd packages/core && bun run e2e <spec-name>
WORKDIR /src/packages/core
RUN bun run test || echo "WARNING: core unit tests reported failures"
WORKDIR /src
