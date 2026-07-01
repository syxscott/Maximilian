# ADR-026: Simulation = Offline Cost/Latency/Quality/Risk

**Status**: Accepted
**Date**: 2026-06-22
**Phase**: 6

## Context

Before committing to a structural change (merge two roles, add a specialist, parallelize a chain), we want to estimate the impact without actually running it.

Live experiments are expensive (real tokens, real latency). We need an offline prediction.

## Decision

`SimulationEngine.simulate(input)` produces:

```ts
{
  orgName: string;
  teamSize: number;
  totalEstimatedCost: number;       // sum of profile.costPerCall
  totalEstimatedLatencyMs: number;  // sum * serialMultiplier
  estimatedAvgQuality: number;      // avg of profile.qualityScore (0-10)
  riskScore: number;                // 0-1, missing profiles + team size penalty
  simulatedAt: string;
}
```

Latency model: `1 + (serialDepth - 1) * 0.3` multiplier (each serial layer adds 30% overhead).

Risk model: `min(1, missingRatio + teamSizePenalty)` where `teamSizePenalty = 0.1 if team > 6 else 0`.

`compare(a, b)` scores both and recommends the better one (or `tie` if delta < 0.05).

## Consequences

**正面**：
- Cheap predictions before committing changes
- `compare` answers "A or B?" for org evolution decisions
- Serializable results (good for `OrganizationMemory` storage)

**负面**：
- Predictions depend on accurate `RoleProfile` data (currently not auto-populated)
- Linear models miss non-linear effects (queue contention, etc.)