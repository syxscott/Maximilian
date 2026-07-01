# Phase 6 — Stage 4: Team Optimizer

**Date**: 2026-06-22
**Status**: ✅ Completed

## Deliverable

`TeamOptimizer.suggest()` returns `TeamOptimizerHint` with structured team suggestions.

## Suggestion Types

- `add_review_node` — no review role present
- `remove_redundant` — two roles with mean score delta < 0.5
- `parallelize` — avg latency > 30s
- `grow_team` — avg quality < 7.5

## Tests

6 unit tests covering all suggestion types, hint format, metric estimation.