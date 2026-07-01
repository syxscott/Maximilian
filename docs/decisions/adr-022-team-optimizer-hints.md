# ADR-022: TeamOptimizer Returns Hints, Not Mutations

**Status**: Accepted
**Date**: 2026-06-22
**Phase**: 6

## Context

Team reorganization is dangerous — reordering a graph mid-execution can leave workspaces in inconsistent states. We need a separation between **observation** (what could improve?) and **action** (apply the change).

## Decision

`TeamOptimizer.suggest()` returns a `TeamOptimizerHint` with structured suggestions:

- `add_review_node` — team lacks a review role
- `remove_redundant` — two roles have mean score delta < 0.5
- `parallelize` — avg latency > 30s
- `grow_team` — avg quality < 7.5
- `shrink_team` (future) — too many underperforming roles

Hints are returned, **never applied automatically**. The API exposes them via `/api/meta/cycle`, and humans (or future workflows) decide whether to apply.

## Consequences

**正面**：
- Safety: meta-system can observe freely without risking org integrity
- Reversibility: hints can be ignored or rejected
- Traceable: each hint is logged to `OrganizationMemory`

**负面**：
- Hints don't materialize as real changes (gap closed by Phase 7?)
- Heuristic thresholds may need tuning per workload