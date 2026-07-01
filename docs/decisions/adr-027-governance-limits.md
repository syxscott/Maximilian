# ADR-027: Governance Enforces Hard Limits Before Any Mutation

**Status**: Accepted
**Date**: 2026-06-22
**Phase**: 6

## Context

A meta-system that can birth and retire agents without limits is dangerous. A bug in `MetaAgent.decide()` could birth 1000 agents, or a stuck loop could keep retiring everything.

We need a final safety net — the gate that says "no, even if all upstream components agreed, this change is unsafe".

## Decision

`GovernanceEngine.check(input)` enforces three hard limits:

| Limit | Default | Rationale |
|-------|---------|-----------|
| `maxAgents` | 20 | Prevent runaway births |
| `maxCapabilities` | 30 | Prevent capability explosion |
| `maxDepth` | 4 | Prevent deep serial chains |

`> limit` (not `≥ limit`) — so `maxAgents: 20` means up to 20 agents are allowed.

When a limit is exceeded:
- The check returns `{ allowed: false, reason, currentCounts }`
- The orchestrator emits a `governance_violation` event to `OrganizationMemory`
- The cycle **continues** (no abort) — violations are observable, not blocking at the cycle level
- The API surfaces violations via `/api/meta/governance/check` and `/api/meta/events?type=governance_violation`

Config can be updated at runtime via `PUT /api/meta/governance/config`.

`maxDepth` is computed as the longest dependency chain in any team graph (using memoized DFS).

## Consequences

**正面**：
- Hard ceiling on org size
- Violations are observable (auditable, alertable)
- Config is hot-reloadable

**负面**：
- Limits need tuning per workload (defaults are conservative)
- Depth calculation is O(N) per cycle (cheap, but could be cached)