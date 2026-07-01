# Phase 6.10 — API Wiring + Integration / E2E Tests

**Date**: 2026-06-22
**Status**: Completed

## What

Wired the meta-system into `@max/api` via the `META_AGENT_ENABLED` feature flag, and added 10 integration tests + 7 E2E tests.

## Implementation

### API Surface (`apps/api/src/routes/meta.ts`)

```
GET    /api/meta/capabilities
GET    /api/meta/capabilities/:id
GET    /api/meta/proposals
POST   /api/meta/cycle
GET    /api/meta/events
GET    /api/meta/events/count
POST   /api/meta/governance/check
POST   /api/meta/simulate
POST   /api/meta/simulate/compare
GET    /api/meta/governance/config
PUT    /api/meta/governance/config
```

### `apps/api/src/index.ts`

- Added `@max/meta-system` dependency
- Reads `META_AGENT_ENABLED` env (default false)
- When true, boots `CapabilityRegistry`, `CapabilityDiscoveryEngine`, `AgentBirthEngine`, `AgentRetirementEngine`, `MetaAgent`, `TeamOptimizer`, `OrganizationMemory`, `GovernanceEngine`, `SimulationEngine`, and `MetaOrchestrator`
- `/api/health` now reports `metaAgent: "on" | "off"`
- All `/api/meta/*` routes mounted only when enabled

### Integration Tests (`apps/api/test/meta-integration.test.ts` — 10 tests)

- discovers → proposes → activates → births → records → memory
- retires an orphan blueprint and records the event
- MetaAgent emits create/delete/merge/split across a rich cycle
- governance blocks when agent limit exceeded
- simulation predicts cost/latency/quality/risk for an org
- team optimizer identifies missing review node
- organization memory timeline is queryable by subject
- capability registry enforces valid lifecycle transitions across cycles
- agent birth writes audit trail per birth
- governance config save/load round-trip

### E2E Tests (`apps/api/test/e2e-meta-mode.test.ts` — 7 tests)

- POST /api/meta/cycle triggers discovery + birth + memory events
- GET /api/meta/events?subject= filters timeline
- POST /api/meta/governance/check returns verdict
- POST /api/meta/simulate returns prediction
- GET/PUT /api/meta/governance/config round-trip
- GET /api/meta/events/count returns event-type counts
- POST /api/meta/cycle validates inputs (400 on invalid)

## Verification

```bash
pnpm --filter @max/api test meta  # 17/17 pass (10 integration + 7 E2E)
pnpm --filter @max/api type-check  # OK
```