# Changelog

All notable changes to Maximilian are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Per-phase detail lives under `docs/changelogs/` — this file is the high-level summary.

## [Unreleased]

### Production readiness — full stack

A 6-phase push took the MVP from a single-process Hono server with file-based JSON
storage to a production-ready, multi-process, multi-tenant-ready system.

#### Added
- **PostgreSQL backend** (Drizzle ORM, `packages/database`). All 12 file-based stores
  gained drop-in PostgreSQL equivalents; selection via `DATABASE_URL`. The 4 highest-
  frequency stores (workspace, metrics, executions, org-events) are Tier 1.
- **JWT authentication** with refresh-token rotation (`/api/auth/*`), 3 RBAC roles
  (admin / operator / viewer), and `bcryptjs` password hashing. Replaces single
  `ADMIN_TOKEN`; falls back to it when `JWT_SECRET` is unset for backwards compat.
- **Multi-tenant schema**: `tenant_id` on every owned table, `tenants` table, full
  isolation enforced in every store's `load` query. Feature-flagged
  (`MULTI_TENANT_ENABLED`).
- **BullMQ task queue** with Redis backend (`packages/queue`, `apps/worker`). API
  enqueues; worker pulls and executes. Decouples request acceptance from
  execution, enables horizontal scaling. Feature-flagged (`TASK_QUEUE_ENABLED`).
- **OpenTelemetry**: traces flow to OTLP HTTP collector, gated by `OTEL_ENABLED`.
- **Prometheus metrics**: `/api/metrics` exposes request counters, duration
  histograms, task duration, active workspaces, and LLM token counters. Admin-token
  gated.
- **Security middleware**: CSP, HSTS (production-only), X-Frame-Options, X-Content-
  Type-Options, Referrer-Policy. Rate-limit (100 req/min/IP) with safe `X-Forwarded-
  For` handling when `TRUSTED_PROXIES` is configured.
- **K8s readiness probe** (`/api/ready`) actually probes Postgres + LLM providers +
  workspace dir, with 2s timeout per probe.
- **Docker Compose** for full stack: `postgres`, `api`, `dashboard`, optional
  `redis` + `worker` (queue profile), optional `otel-collector` + `prometheus`
  (observability profile). Multi-stage Dockerfiles for API and dashboard.
- **GitHub Actions CI**: type-check + test + build with PG service container. 170+
  tests across 16 packages.
- **OpenAPI 3.1 spec** auto-generated from zod-openapi route definitions. All 67
  routes documented across 13 tag groups; served at `/api/openapi.json` with
  Swagger UI at `/api/docs`.
- **API versioning**: every route mounted under both `/api/` and `/api/v1/`.
- **Cursor-based pagination** on all list endpoints (`?cursor=&limit=`).
- **SSE event bus** (`/api/events/bus`) with replay buffer; supports both
  workspace-scoped and global subscriptions.
- **VISUALIZER adapter** for the execution-graph UI (`/api/obs/graph/:id`,
  `/api/obs/timeline`).
- **Top-level scripts**: `pnpm test` (turbo-driven), `pnpm start:full` (api +
  dashboard + worker), `pnpm bootstrap` (production-data seeder).

#### Changed
- API is `OpenAPIHono` end-to-end; `c.req.valid("json")` is the standard
  validation pattern. All request bodies, params, and responses are zod-typed.
- Logging is structured JSON via `pino` (not `console.log`); every request gets
  a `X-Request-Id` header for correlation.
- `apps/web` (SolidJS) was folded into `apps/dashboard` (React 19) — single
  frontend.
- All request handlers wrap execution in OpenTelemetry spans; failures recorded
  in Prometheus.

#### Fixed
- Race condition in JWT refresh token rotation (TOCTOU between read and revoke).
- Rate-limit bypass via spoofed `X-Forwarded-For` when no `TRUSTED_PROXIES` set.
- `birth.birth()` returning undefined crashing the HITL approve path with a
  confusing TypeError.
- Memory leak in SSE reconnect (listener never unsubscribed from runtime).
- Phase 6 任务执行时机无法被 Prometheus 监控 (no active_workspaces tracking).

## [0.1.0] — 2026-06-22

### Phases 1-8 (MVP)
Initial MVP. The full evolution from a simple file-backed agent runtime through
self-evolution, DAGS team composition, and the meta-system. See
`docs/changelogs/2026-06-22-*.md` for per-phase detail.

Highlights:
- Agent runtime with multi-agent task execution (`@max/core`).
- Evolution engine: profile store, leaderboard, version snapshots, auto-promotion.
- DAGS team composition from user request.
- Meta-system: capability discovery, agent birth/retirement, team optimization,
  organization memory, governance engine, HITL approval pipeline, simulation.
- Autonomy orchestrator + learning dashboard.
- React 19 dashboard (originally SolidJS companion).
- File-backed storage for all 12 stores (later dual-mode with PostgreSQL).

[Unreleased]: https://github.com/anthropics/maximilian/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/anthropics/maximilian/releases/tag/v0.1.0
