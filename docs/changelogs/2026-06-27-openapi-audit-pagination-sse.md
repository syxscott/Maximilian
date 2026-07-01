# 2026-06-27 — OpenAPI · Audit Log · Pagination · SSE Reconnect

**Status**: ✅ Completed (one-shot session)

Four follow-ups to the theme/perf/permissions session, each closing a
gap that surfaced the moment the prototype was actually used:

1. **OpenAPI + Swagger UI** — every `/api/permissions/*` route and the
   `/workspaces/{id}/events` + `/providers` routes are now registered
   through `api.openapi()` so they show up in `/api/docs`.
2. **Permission decision audit log** — every `ask → allow/deny` decision
   the runtime gate surfaces is recorded into a bounded in-memory buffer
   and exposed via `GET /api/permissions/audit`.
3. **List endpoint pagination** — `paginate()` helper added; list metrics,
   list agents, list events, list capabilities, list executions, list
   evolutions, and usage/daily now return `{ items, nextCursor, total }`.
4. **SSE reconnect with Last-Event-ID** — `/workspaces/:id/stream` now
   writes `id:` lines, buffers the last 64 events per workspace, and
   replays missed events on reconnect via the `Last-Event-ID` header.

## New files

| File | Purpose |
|------|---------|
| `apps/api/src/lib/pagination.ts` | `PaginationQuerySchema`, `paginate()`, `PaginatedResult<T>` — shared slice + cursor logic |
| `apps/api/src/lib/sse-replay.ts` | `SseReplayBuffer` per-workspace ring buffer + `parseLastEventId` + `encodeSseFrame` |
| `apps/api/src/routes/system.ts` | `listProvidersRoute` createRoute definition (for OpenAPI registration) |
| `packages/core/src/permission-audit.ts` | `PermissionAuditLog` bounded buffer + `PermissionAuditEntry` / `PermissionAuditQuery` types |
| `apps/api/test/openapi-permissions.test.ts` | 3 tests: registers all 6 permission paths, documents PUT body schema, registers workspace + system routes |
| `apps/api/test/pagination.test.ts` | 10 tests: schema validation, cursor continuation, stale cursor fallback, getId for objects, empty input |
| `apps/api/test/sse-replay.test.ts` | 12 tests: monotonic ids, since(lastEventId), eviction keeps counter monotonic, parseLastEventId edge cases, frame encoding |
| `packages/core/test/permission-audit.test.ts` | 7 tests: chronological order, limit cap, filters, since, eviction, getByRequestId, MAX_LIMIT clamp |

## Modified files

| File | Change |
|------|--------|
| `apps/api/src/schemas.ts` | Added `PermissionsConfigSchema`, `ResolveRequestSchema`/`ResolveResponseSchema`, `TestRequestSchema`/`TestResponseSchema`, `AnswerRequestSchema`/`AnswerResponseSchema`, `PermissionAuditQuerySchema`, `PermissionAuditResponseSchema` |
| `apps/api/src/routes/permissions.ts` | 6 routes wrapped with `createRoute(...)` (tags: `permissions`); added `audit` route + handler; `PermissionAnswerPort` extended with `getPermissionAudit?()` |
| `apps/api/src/routes/workspace.ts` | Added `getWorkspaceEventsRoute` + `streamWorkspaceRoute` createRoute definitions (tags: `workspaces`); extracted `getWorkspaceEvents()` handler; tagged all existing routes |
| `apps/api/src/routes/evolution.ts` | `listMetrics` and `listAgents` paginated via `paginate()` |
| `apps/api/src/routes/obs.ts` | `listExecutions` and `listEvolutions` paginated |
| `apps/api/src/routes/meta.ts` | `listCapabilities` and `listEvents` paginated |
| `apps/api/src/routes/usage.ts` | `daily` paginated by date |
| `apps/api/src/index.ts` | Imported `listProvidersRoute` + 6 permission routes + audit route; replaced plain `api.get/post` with `api.openapi()` for permissions + events + providers; instantiated `SseReplayBuffer`; SSE stream now writes `id:` frames, replays `since(lastEventId)` on reconnect; OpenAPI doc adds `tags` for `workspaces`/`permissions`/`system` |
| `packages/core/src/runtime.ts` | `awaitPermission` records an `ask` row in `permissionAudit`; `resolvePermission` records an `allow`/`deny` row paired by `requestId`; new `getPermissionAudit(query)` method; `permissionAuditLog` accessor |
| `packages/core/src/tool-integration.ts` | `ToolLoopOptions.awaitPermission` signature extended with `meta: { workspaceId, taskId, tool, target }` so the runtime can write audit rows without re-parsing the error |
| `packages/core/src/index.ts` | Exported `PermissionAuditLog` + its types |
| `apps/dashboard/src/App.tsx` | `es.onerror` no longer closes the EventSource — the browser auto-reconnects and resends `Last-Event-ID` for us |
| `apps/dashboard/src/lib/permissions.ts` | Removed dead `usePermissionPrompt` (replaced by App.tsx SSE handler); `PendingPermission` interface kept for callers |

## Tests added

| Suite | Count | What it covers |
|-------|-------|----------------|
| `apps/api/test/openapi-permissions.test.ts` | 3 | All 6 permission paths registered; PUT body schema documented; workspace + system routes registered |
| `apps/api/test/pagination.test.ts` | 10 | Schema defaults/coercion/bounds; first page; cursor continuation; end-of-list; stale cursor fallback; object arrays via `getId`; empty input |
| `apps/api/test/sse-replay.test.ts` | 12 | Monotonic ids per workspace; `since(lastEventId)`; eviction keeps counter monotonic; `parseLastEventId` edge cases; `encodeSseFrame` shape |
| `packages/core/test/permission-audit.test.ts` | 7 | Chronological order; limit cap; filter by tool/workspaceId; `since`; eviction; `getByRequestId`; MAX_LIMIT clamp |
| `packages/core/test/permission-loop-integration.test.ts` | +1 assertion | Audit log: `ask` and `allow` rows paired by `requestId`, sharing `workspaceId`/`taskId`/`tool`/`target`, `promptedAt` matches |
| `apps/api/test/permissions.test.ts` | +3 audit | 503 when runtime missing; entries returned with filters; 400 on out-of-range limit |

Total: **+35 tests**. Monorepo now has **758 tests passing** (up from 723).

## Behaviour summary

### OpenAPI

- All `/api/permissions/*` routes (GET, PUT, /resolve, /test, /reset,
  /answer, /audit) are registered via `api.openapi(route, handler)`
- `/workspaces`, `/workspaces/{id}`, `/workspaces/{id}/events`,
  `/workspaces/{id}/artifacts`, `/workspaces/{id}/artifacts/{name}`,
  `/providers` similarly registered
- `/api/openapi.json` now includes `tags: [workspaces, permissions, system]`
  for Swagger UI grouping
- `/health` and `/ready` keep their `api.get` form — their response shapes
  are dynamic and don't fit a single zod schema; they remain documented
  in the README instead

### Audit log

- Every `ask` prompt that the runtime surfaces is recorded as
  `{ decision: "ask", at: <now> }` keyed by the stable `requestId`
- When the user answers, a second row is appended:
  `{ decision: "allow" | "deny", at: <now>, promptedAt: <ask row's at> }`
  sharing the same `requestId`
- The buffer holds 1000 entries by default (capacity configurable);
  eviction preserves the monotonic `requestId` counter
- `GET /api/permissions/audit?since=&limit=&tool=&workspaceId=` returns
  `{ items, total }`; 503 when the runtime isn't wired up

### Pagination

- `PaginationQuerySchema` is `{ cursor?: string, limit: 1..100 (default 20) }`
- `paginate(items, query, getId)` slices by `cursor = getId(items[i])`,
  returning `{ items, nextCursor, total }`
- Stale cursors fall back to page 0 rather than 400 so a client whose
  cursor refers to a deleted item doesn't get stuck
- Applied to: `/evolution/metrics`, `/evolution/agents`,
  `/meta/capabilities`, `/meta/events`, `/obs/executions`,
  `/obs/evolutions`, `/obs/usage/daily`
- `/workspaces` already had this shape; unchanged

### SSE reconnect

- `/workspaces/:id/stream` writes `id: <n>\ndata: <json>\n\n` frames
  so the browser's `EventSource` tracks the latest id automatically
- A per-workspace `SseReplayBuffer` (capacity 64) keeps recent payloads
- On reconnect, the `Last-Event-ID` request header is parsed and all
  buffered events with `id > lastEventId` are replayed before the live
  listener attaches — so a dropped connection during a tool-call burst
  doesn't lose events
- Dashboard's `App.tsx` no longer closes the EventSource on `onerror`;
  the browser auto-reconnects and resends `Last-Event-ID` for us
- Dead `usePermissionPrompt` hook removed (App.tsx already lifts the
  SSE event into state and passes `pending` down to `PermissionDialog`)

## Verification

```
pnpm -r type-check     # clean across all 24 packages
pnpm -r test           # 758 tests, 0 failures
```

## Non-goals (deferred)

- Cross-worker SSE replay — currently each API process keeps its own
  `SseReplayBuffer`. A client reconnecting to a different worker will
  miss events. Acceptable at our scale; if we ever need cross-worker
  replay, the buffer will move to Redis.
- Audit log durability — the buffer is in-memory only. A process
  restart loses the audit trail. The `PermissionAuditLog` accepts a
  `persistPath` (writes JSON on every record), but it's not wired in
  production yet. A future change can opt-in via config.
- Converting `/auth/*`, `/tenants`, `/chat`, `/events/bus`,
  `/evolution/*`, `/learning/*`, `/executions/*`, `/meta/*`, `/obs/*`,
  `/gov/*` to `api.openapi()` — these have hand-written validation
  already; the priority for this session was the newly-added
  permissions family + workspace events. Other routes will be migrated
  incrementally as they're touched.
