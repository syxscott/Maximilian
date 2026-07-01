# Phase 6.4 — Team Optimizer

**Date**: 2026-06-22
**Status**: Completed

## What

`TeamOptimizer.suggest()` produces a `TeamOptimizerHint` with structured team-adjustment suggestions.

## Implementation

`packages/meta-system/src/team-optimizer.ts`:

- `add_review_node` — team lacks a review role
- `remove_redundant` — two roles have mean score delta < 0.5
- `parallelize` — avg latency > 30s
- `grow_team` — avg quality < 7.5

Heuristics only. Suggestions are returned, **never applied automatically**.

## Decisions

- ADR-022: TeamOptimizer returns hints, not mutations

## Tests (6 unit tests)

- suggests add_review_node when no review in graph
- does not suggest when review exists
- suggests parallelize for high avg latency
- suggests grow_team for low avg quality
- returns hint with id and timestamp
- estimates metrics from graph and executions

## Verification

```bash
pnpm --filter @max/meta-system test  # 6/6 pass
```