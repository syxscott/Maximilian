# syntax=docker/dockerfile:1.7

# ─── base ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# ─── deps ──────────────────────────────────────────────────────────────
FROM base AS deps
# Native module build deps (better-sqlite3 compiles from source on alpine
# musl — no prebuilt binaries for that ABI).
RUN apk add --no-cache python3 make g++
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig*.json ./
COPY apps/worker/package.json ./apps/worker/
COPY packages ./packages
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter=@max/worker...

# ─── build ─────────────────────────────────────────────────────────────
FROM deps AS build
COPY apps/worker ./apps/worker
COPY tsconfig*.json ./
RUN pnpm --filter @max/worker run type-check
# Build only the worker and its workspace deps. The workspace also
# contains "optional" packages like @max/compat-shims (peer-only shims
# for ink / hono / drizzle that the consumer must install separately).
# Building them inside the worker image tries to tsc packages whose
# devDeps aren't installed by the deps stage's `--filter=@max/worker...`
# and fails on missing type defs. Scope to worker's closure.
RUN pnpm --recursive --filter @max/worker... run build

# ─── runtime ──────────────────────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production
# The --prod install below re-runs better-sqlite3's install script (it
# compiles from source on alpine musl — no prebuilt for this ABI), so the
# runtime stage needs the same build chain as the deps stage.
RUN apk add --no-cache python3 make g++
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/worker/package.json ./apps/worker/
COPY packages ./packages
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter=@max/worker...
COPY --from=build /app/packages/*/dist ./packages/*/dist
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
WORKDIR /app/apps/worker
CMD ["node", "dist/index.js"]
