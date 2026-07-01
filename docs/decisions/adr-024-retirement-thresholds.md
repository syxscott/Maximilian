# ADR-024: Retirement = Lookback Window + Two Thresholds

**Status**: Accepted
**Date**: 2026-06-22
**Phase**: 6

## Context

Agents become stale (model updates, capability shifts, capability retirement). We need a deterministic policy that decides when to retire an agent.

Without thresholds, retirements become arbitrary (someone has to decide). With too-aggressive thresholds, valuable agents get killed. With too-loose thresholds, the org bloats.

## Decision

`AgentRetirementEngine.evaluate(blueprintId, role, executions)` applies:

| Reason | Condition |
|--------|-----------|
| `low_usage` | `usageCount < minUsageToKeep` (default 2) |
| `low_score` | `avgScore < minScoreToKeep` (default 4.0) |
| `capability_retired` | (parent capability is retired) |
| `replaced_by_newer` | (a higher-version blueprint exists for same role) |
| `manual` | (future: human override) |

Lookback: most recent `RETIREMENT_THRESHOLDS.lookback` (default 100) executions.

Sample-size guard: at least `minUsageToKeep` executions in the lookback window, otherwise retire for `low_usage`.

Retirement decisions can be applied via the optional `retireBlueprint(id)` callback, but the engine never deletes data — it emits a decision.

## Consequences

**正面**：
- Deterministic, auditable policy
- Two thresholds give a safety net (low usage OR low score)
- Lookback window prevents killing agents on bad days

**负面**：
- Cold-start problem: new agents have < 2 executions → flagged for retirement (mitigation: minUsageForBirth governance gate)
- Thresholds need per-domain tuning (default is conservative)