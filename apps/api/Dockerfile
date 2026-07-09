# syntax=docker/dockerfile:1.7

# ─── base ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# ─── deps ──────────────────────────────────────────────────────────────
# Build dependencies in a separate layer so they cache across code changes.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig*.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/dashboard/package.json ./apps/dashboard/
COPY packages ./packages
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter=@max/api... --filter=@max/dashboard...

# ─── build ─────────────────────────────────────────────────────────────
# Compile TypeScript packages (workspace internal deps).
FROM deps AS build
COPY apps/api ./apps/api
COPY apps/dashboard ./apps/dashboard
COPY tsconfig*.json ./
RUN pnpm --filter @max/api run type-check
# Build only the api and its workspace deps. The workspace also contains
# "optional" packages like @max/compat-shims (peer-only shims for ink /
# hono / drizzle that the consumer must install separately). Building
# them inside the api image tries to tsc packages whose devDeps aren't
# installed by the deps stage's `--filter=@max/api...` and fails on
# missing type defs (`ink`, `node:*`, etc.). Scope to api's closure.
RUN pnpm --recursive --filter @max/api... run build

# ─── runtime ──────────────────────────────────────────────────────────
# Slim runtime with only production deps + compiled output.
FROM base AS runtime
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/dashboard/package.json ./apps/dashboard/
COPY packages ./packages
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    HUSKY=0 pnpm install --frozen-lockfile --prod --filter=@max/api...
COPY --from=build /app/packages/*/dist ./packages/*/dist
COPY --from=build /app/apps/api/dist ./apps/api/dist
WORKDIR /app/apps/api
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:3001/api/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
