# Threat Model — Maximilian

**Owner**: Platform team
**Effective from**: 2026-08-18 (Phase 10)
**Review cadence**: Quarterly

This document enumerates the threats Maximilian defends against using the
STRIDE framework. Each category lists the threat, the defense(s), and the
test/coverage that confirms the defense works. New features should add a
new threat row to the relevant category before merging.

STRIDE categories:

- **S**poofing — pretending to be someone/something else
- **T**ampering — modifying data the attacker shouldn't be able to
- **R**epudiation — denying an action happened
- **I**nformation Disclosure — leaking data the attacker shouldn't see
- **D**enial of Service — exhausting resources
- **E**levation of Privilege — gaining more permissions than granted

---

## S — Spoofing

| Threat | Defense | Where | Tests |
| ------ | ------- | ----- | ----- |
| Forged JWT access token | HMAC-SHA256 (or EdDSA) signature verification via `jose` | `apps/api/src/auth/jwt.ts` (verifyAccessToken) | `apps/api/test/auth.test.ts` |
| JWT replay after revocation | Short access-token TTL (15m) + refresh-token rotation | `apps/api/src/auth/jwt.ts` | manual rotation test |
| Tenant spoofing via header | `tenantId` always derived from JWT payload, never from request headers | `apps/api/src/auth/middleware.ts`, `tenant-guard.ts` | `tenant-guard.test.ts` |
| Cross-tenant JWT (token issued for tenant A used at tenant B's endpoint) | `assertSameTenant()` checks JWT tenant vs URL tenant before store call | `apps/api/src/index.ts` route handlers | `tenant-guard.test.ts` |
| Opencode session forged by rogue SDK | OpencodeHttpClient only accepts trusted server URL from `OPENCODE_BASE_URL` env var | `packages/core-thin-sdk/src/client.ts` | manual + supervised startup test |

---

## T — Tampering

| Threat | Defense | Where | Tests |
| ------ | ------- | ----- | ----- |
| SQL injection via tenant id | Tenant-id regex (`/^[a-zA-Z0-9_-]{1,64}$/`) + reserved-name blocklist; parameterized queries in every store | `packages/database/src/tenant-guard.ts`, `packages/database/src/*.ts` | `tenant-guard.test.ts`, `pg-integration.test.ts` |
| SQL injection via query filter | `sanitizeFilter()` strips/validates `tenantId` from filters; schema-validated inputs | `tenant-guard.ts`, route handlers | `tenant-guard.test.ts` (filter cross-tenant test) |
| Tampering with workspace state via direct PG write | All writes go through Drizzle stores which enforce `WHERE tenant_id = ?` | `packages/database/src/pg-*.ts` | `pg-integration.test.ts` |
| Tampering with opencode plugin rules (Phase 2 H3) | `OpencodePermissionTranslator` enforces first-match-wins with deny-then-allow ordering; `always` cannot override `deny` | `packages/tools/src/opencode-permission-translator.ts` | `packages/tools/test/opencode-permission-translator.test.ts` (H3 regression) |
| Tampering with replay-engine output | TruthMeasurement verified against proposal-id provenance | `packages/meta-system/src/replay-engine.ts` | `replay-engine.test.ts` (M8 regression) |
| Tampering with meta-cycle proposals | Proposals signed by orchestrator identity; `applyMutation` validates signature before mutation | `packages/meta-system/src/safe-rollout.ts` | `safe-rollout-rollback.test.ts` |

---

## R — Repudiation

| Threat | Defense | Where | Tests |
| ------ | ------- | ----- | ----- |
| User denies sending a request | Pino structured logs + OTel trace IDs per request | `packages/telemetry/src/logger.ts` | n/a (operational) |
| User denies approving an action | `approval-resolved` event with decision + comment emitted to ledger | `packages/core/src/runtime.ts` (Phase 6 M10) | `approval-pause.test.ts` |
| Operator denies pushing a rollback | `SafeRollout.revert()` writes a snapshot before applying mutation | `packages/meta-system/src/safe-rollout.ts` (Phase 7) | `safe-rollout-rollback.test.ts` |
| LLM call result disputed | TruthAudit verdicts persisted with proposal-id + sample-size for reproducibility | `packages/meta-system/src/truth-audit.ts` | `phase8-truth-audit.test.ts` |

---

## I — Information Disclosure

| Threat | Defense | Where | Tests |
| ------ | ------- | ----- | ----- |
| JWT secret leaked | Secret injected via env var (`JWT_SECRET`); never logged; rotation runbook in `SECRETS.md` | `apps/api/src/index.ts` | manual |
| Opencode SDK leaking PII to logs | Logger redacts fields named `password`, `secret`, `token`, `apikey` | `packages/telemetry/src/logger.ts` | manual |
| Opencode plugin allowing unknown tool by default (Phase 2 H2) | Default for unknown tool = `"deny"` | `packages/tools/src/opencode-permission-translator.ts` | `opencode-permission-translator.test.ts` (H2 regression) |
| Tenant A reading tenant B's workspaces via URL injection | Tenant context frozen after JWT decode; sanitizeFilter rejects mismatched tenantId | `tenant-guard.ts` | `tenant-guard.test.ts` |
| Error response leaking stack trace | Global error handler returns generic message; full stack logged server-side only | `apps/api/src/index.ts` | manual |
| LLM response containing prompt-injection payload from upstream | Self-critique loop (Phase 1) runs a second pass on suspicious responses; tool calls go through permission translator | `packages/core/src/runtime.ts` | `runtime.test.ts` |

---

## D — Denial of Service

| Threat | Defense | Where | Tests |
| ------ | ------- | ----- | ----- |
| API rate exhaustion | `hono-rate-limiter` 100 req/min/IP for unauthenticated; stricter for expensive endpoints | `apps/api/src/index.ts` | manual load test |
| Long-running opencode call burning tokens | AbortSignal propagates to `OpencodeSdk.abortSession` (Phase 3 M2) | `packages/core/src/opencode-executor.ts` | `runtime-opencode.test.ts` |
| opencode session leak draining server memory | SessionPool eviction + Phase 9 leak metric surfaces sustained leak rate | `packages/core-thin-sdk/src/session-pool.ts`, `packages/core/src/opencode-executor.ts` | `opencode-executor-metrics.test.ts` |
| BullMQ worker stuck on stalled job | `Runtime.abortAll()` called on SIGTERM, BullMQ stalled-job detector at 30s | `packages/core/src/runtime.ts`, `apps/worker/src/index.ts` | manual |
| TruthAudit hot-loop | `TRUTH_AUDIT_CONFIG.minSampleSize` (5) gates verdict computation | `packages/meta-system/src/types.ts` | `property-truth-audit.test.ts` |
| Stuck approval prompts blocking workspace | `Runtime.abort()` rejects parked permission/approval resolvers | `packages/core/src/runtime.ts` | `approval-pause.test.ts` |

---

## E — Elevation of Privilege

| Threat | Defense | Where | Tests |
| ------ | ------- | ----- | ----- |
| User calling admin endpoint with normal JWT | RBAC middleware checks role claim in JWT; admin endpoints require `role: "admin"` | `apps/api/src/auth/middleware.ts` | manual |
| Opencode agent escalating via `bash` tool | Permission translator defaults unknown tool to `deny`; bash requires explicit `allow` rule per pattern | `packages/tools/src/opencode-permission-translator.ts` | `opencode-permission-translator.test.ts` |
| Meta-agent promoting capability past `maxCapabilities` cap | `governance.check()` blocks promotions past cap | `packages/meta-system/src/orchestrator.ts` | `meta-unit.test.ts` |
| Rollout enabling shadow → full without canary gate | `SafeRollout` mode transitions enforced `shadow → canary → full` only | `packages/meta-system/src/safe-rollout.ts` | `phase8-unit.test.ts` |
| Reverse-proxy header injection (X-Forwarded-For bypass) | Hono uses `trustProxy: false` by default; only set true when behind known proxy | `apps/api/src/index.ts` | manual |

---

## Out-of-scope (explicitly accepted risks)

These risks are tracked elsewhere and not mitigated here:

- **OAuth/SSO**: deferred to a future enterprise-integration project. Today
  Maximilian uses local email+password with JWT.
- **Vault / SOPS secrets rotation**: documented in `SECRETS.md`; not yet
  integrated.
- **Side-channel timing attacks on JWT verify**: `jose`'s `jwtVerify` uses
  constant-time HMAC compare; we rely on the library.
- **Physical access to K8s nodes**: assumed mitigated by cloud provider.

---

## Adding a new threat

If you find a new attack vector:

1. Pick the STRIDE category.
2. Add a row with threat / defense / where / tests.
3. If the threat has no test, add one in the same PR.
4. Update the "out-of-scope" section if you're choosing to defer.