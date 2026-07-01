# Phase 6 — Stage 3: MetaAgent

**Date**: 2026-06-22
**Status**: ✅ Completed

## Deliverable

`MetaAgent.decide()` returns `AgentChangePlan` with create/delete/merge/split decisions.

## Decision Triggers

| Action | Trigger |
|--------|---------|
| create | proposal evidence ≥ 3 |
| delete | retirement decision (always) |
| merge | 2 roles with avg score < 5.0 and usage ≥ 5 |
| split | role avg duration > 60s and usage ≥ 5 |

## Tests

8 unit tests covering all four actions, no-action healthy state, expected impact computation, plan id format.