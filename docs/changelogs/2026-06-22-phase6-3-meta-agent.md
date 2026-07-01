# Phase 6.3 — MetaAgent (create / delete / merge / split)

**Date**: 2026-06-22
**Status**: Completed

## What

`MetaAgent.decide()` produces an `AgentChangePlan` with up to 4 action types.

## Implementation

`packages/meta-system/src/meta-agent.ts`:

| Action | Trigger | Config |
|--------|---------|--------|
| `create` | proposal with evidence ≥ threshold | `minProposalEvidence = 3` |
| `delete` | retirement decision | (always) |
| `merge` | 2 roles both below score threshold with usage ≥ 5 | `mergeScoreThreshold = 5.0` |
| `split` | role avg duration > threshold with usage ≥ 5 | `splitLatencyMs = 60000` |

The plan includes `expectedImpact` (cost/latency/quality delta) and a human-readable rationale.

## Decisions

- ADR-021: MetaAgent decisions = create/delete/merge/split

## Tests (8 unit tests)

- emits create for proposals with enough evidence
- skips create if evidence is insufficient
- emits delete for each retirement decision
- emits merge when two roles have low score
- emits split for high-latency role
- returns empty plan when healthy
- computes expected impact
- produces deterministic plan id

## Verification

```bash
pnpm --filter @max/meta-system test  # 8/8 pass
```