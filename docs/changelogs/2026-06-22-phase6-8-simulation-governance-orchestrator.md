# Phase 6.8 / 6.9 / 6.X — Simulation, Governance, Orchestrator

**Date**: 2026-06-22
**Status**: Completed

## What

Three components:

- **6.8** `SimulationEngine` — offline cost / latency / quality / risk prediction
- **6.9** `GovernanceEngine` — hard limits (maxAgents=20, maxCapabilities=30, maxDepth=4)
- **6.X** `MetaOrchestrator` — ties the whole loop together

## Implementation

### Simulation

`packages/meta-system/src/simulation.ts`:

- `simulate(input)` returns `{ totalEstimatedCost, totalEstimatedLatencyMs, estimatedAvgQuality, riskScore, teamSize }`
- Latency model: `1 + (serialDepth - 1) * 0.3` (each serial layer +30%)
- Risk model: `min(1, missingRatio + teamSizePenalty)`
- `compare(a, b)` recommends the better org

### Governance

`packages/meta-system/src/governance.ts`:

- `check({ graphs, capabilities, blueprints })` returns `{ allowed, reason, currentCounts }`
- `maxAgents`, `maxCapabilities` checked with `>` (allows exactly the limit)
- `maxDepth` computed via memoized DFS over team-graph `dependsOn`
- `loadConfig()` / `saveConfig()` for hot-reload via `<rootDir>/governance-config.json`

### Orchestrator

`packages/meta-system/src/orchestrator.ts`:

7-step cycle:

1. **DISCOVER** — find proposals from signals
2. **PROPOSE** — register in CapabilityRegistry
3. **ACTIVATE** — proposed → experimental → active
4. **BIRTH** — materialize agents for activated capabilities
5. **RETIRE** — evaluate all active blueprints
6. **META-DECIDE** — emit create/delete/merge/split
7. **TEAM OPTIMIZE** — produce hint
8. **GOVERN** — check limits

Each step records an `OrganizationEvent`.

## Decisions

- ADR-026: Simulation = offline cost/latency/quality/risk
- ADR-027: Governance enforces hard limits before any mutation

## Bug Fixes

- `maxDepth` recursive computation had a buggy `visited` set that always returned 0 on re-entry. Fixed with proper memoization.
- `> limit` instead of `>= limit` (so `maxAgents: 20` allows 20 agents)
- Orchestrator's activation step had stale `c` reference — fixed by capturing `transition()` return value

## Tests (6 + 7 + 8 = 21 unit tests)

Simulation (6): basic / serial multiplier / missing profiles / compare / tie / empty org.
Governance (7): under limits / maxAgents / maxCapabilities / maxDepth / ignores retired blueprints / ignores retired capabilities / save+load config.
Orchestrator (8): empty cycle / discovery / activation+birth / retirement / team optimizer / org memory / governance block / governance violation event.

## Verification

```bash
pnpm --filter @max/meta-system test  # 21/21 pass
```