FROM node:24-alpine

RUN apk add --no-cache git bash && corepack enable \
 && git config --system --add safe.directory '*'

WORKDIR /reviewer

COPY package.json pnpm-lock.yaml* .npmrc ./

ARG BUILD_TARGET=prod

# pnpm honors `.npmrc` keys natively, including `minimum-release-age` which
# gives every install a supply-chain quarantine for free.
#
# prod: install deps inside the image (CI deployment ships self-contained).
# test: skip install — host bind-mounts node_modules at runtime, so the
# build is just a COPY and rebuilds are near-free.
RUN if [ "$BUILD_TARGET" = "prod" ]; then \
        pnpm install --prod --frozen-lockfile; \
    fi

# Source. Prompts + schemas live next to each stage's index.ts under
# src/stages/<stage>/ — no separate top-level folders to copy.
COPY src ./src
COPY tsconfig.json ./

# Tests + vitest config — always copied; harmless in prod images and
# avoids a second Dockerfile.
COPY tests ./tests
COPY vitest.config.ts ./

RUN ln -s /reviewer/src/cli.ts /usr/local/bin/reviewer && chmod +x /reviewer/src/cli.ts

WORKDIR /workspace
ENTRYPOINT ["node", "--experimental-transform-types", "--disable-warning=ExperimentalWarning", "/reviewer/src/cli.ts"]
