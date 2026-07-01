# ADR-021: MetaAgent Decisions = create / delete / merge / split

**Status**: Accepted
**Date**: 2026-06-22
**Phase**: 6

## Context

The meta-agent needs a small, composable vocabulary for changing the organization. Each action should:

1. Be easy to reason about (no hidden side-effects)
2. Be reversible (so failed experiments can be undone)
3. Be observable (each decision has a reason + impact estimate)

## Decision

`MetaAgent.decide()` emits `AgentChangePlan` decisions, each one of:

| Action | Trigger | Target |
|--------|---------|--------|
| `create` | Proposal has ≥ `minProposalEvidence` (3) signals | `${capabilityId}_agent` |
| `delete` | Retirement decision with reason | `r.role` |
| `merge` | Two roles both have avg score < `mergeScoreThreshold` (5.0) with usage ≥ 5 | `low_a` → `low_b` |
| `split` | Role avg duration > `splitLatencyMs` (60s) with usage ≥ 5 | `${role}_planner` |

The plan also computes `expectedImpact`:
- `create`: +1 cost, +0.2 quality
- `delete`: -1 cost
- `merge`: -0.5 cost, -500ms latency, -0.1 quality
- `split`: +0.5 cost, -2000ms latency, +0.3 quality

The plan is recorded to `OrganizationMemory` for replayability.

## Consequences

**正面**：
- 4 actions cover 90% of organizational changes
- Each action is reversible (create → delete, merge target can be re-split, split can be re-merged)
- Decisions are auditable via `OrganizationMemory`

**负面**：
- Threshold tuning required (currently defaults are conservative)
- `merge` only pairs first two low-score roles (could miss better 3-way merges)