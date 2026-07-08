# syntax=docker/dockerfile:1.7

# ─── base ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# ─── deps ──────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/worker/package.json ./apps/worker/
COPY packages ./packages
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter=@max/worker...

# ─── build ─────────────────────────────────────────────────────────────
FROM deps AS build
COPY apps/worker ./apps/worker
COPY tsconfig.base.json ./
RUN pnpm --filter @max/worker run type-check
RUN pnpm --recursive --filter @max/* run build

# ─── runtime ──────────────────────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/worker/package.json ./apps/worker/
COPY packages ./packages
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    HUSKY=0 pnpm install --frozen-lockfile --prod --filter=@max/worker...
COPY --from=build /app/packages/*/dist ./packages/*/dist
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
WORKDIR /app/apps/worker
CMD ["node", "dist/index.js"]
