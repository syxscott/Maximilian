# syntax=docker/dockerfile:1.7

# ─── build ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/dashboard/package.json ./apps/dashboard/
COPY packages ./packages
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter=@max/dashboard...

COPY apps/dashboard ./apps/dashboard
COPY tsconfig.base.json ./
RUN pnpm --filter @max/dashboard run build

# ─── runtime ──────────────────────────────────────────────────────────
FROM nginx:1.31-alpine AS runtime
COPY --from=build /app/apps/dashboard/dist /usr/share/nginx/html
COPY apps/dashboard/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -q --spider http://localhost/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
