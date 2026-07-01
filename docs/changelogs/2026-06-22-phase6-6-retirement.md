# Phase 6.6 — Agent Retirement Engine

**Date**: 2026-06-22
**Status**: Completed

## What

`AgentRetirementEngine.evaluate()` decides whether a blueprint should be retired based on usage and score.

## Implementation

`packages/meta-system/src/agent-retirement.ts`:

| Reason | Condition |
|--------|-----------|
| `low_usage` | `usageCount < minUsageToKeep` (default 2) |
| `low_score` | `avgScore < minScoreToKeep` (default 4.0) |

Lookback: most recent 100 executions per blueprint.

`evaluateAll(ids, executions)` batches decisions across all active blueprints.

Optional `retireBlueprint(id)` callback fires for each decision (consumer marks `retiredAt`).

## Decisions

- ADR-024: Retirement = lookback window + two thresholds

## Tests (6 unit tests)

- retires a blueprint with zero usage
- retires a blueprint with low score
- keeps a healthy blueprint
- retires blueprint with low usage
- evaluateAll batches decisions
- calls retireBlueprint side-effect

## Verification

```bash
pnpm --filter @max/meta-system test  # 6/6 pass
```