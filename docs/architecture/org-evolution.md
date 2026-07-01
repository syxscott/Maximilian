# Organization Evolution Diagram (Phase 6)

```
       t=0                              t=1                              t=2
        │                                │                                │
        │                                │                                │
   ┌────▼─────┐                    ┌─────▼─────┐                    ┌─────▼─────┐
   │  Active  │                    │  Active   │                    │  Active   │
   │  Caps: 5 │                    │  Caps: 6  │                    │  Caps: 6  │
   │  Agents: │                    │  Agents:  │                    │  Agents:  │
   │  5       │                    │  6        │                    │  5        │
   │          │                    │           │                    │           │
   │  ┌─────┐ │                    │  ┌─────┐  │                    │  ┌─────┐  │
   │  │ FE  │ │   signal: mobile   │  │ FE  │  │   signal: low     │  │ FE  │  │
   │  │ BE  │ │   "Build iOS"      │  │ BE  │  │   score on legacy │  │ BE  │  │
   │  │ DB  │ │ ─────────────►     │  │ DB  │  │ ─────────────►    │  │ DB  │  │
   │  │ Rv  │ │   cycle()          │  │ Rv  │  │   cycle()         │  │ Rv  │  │
   │  │ ML  │ │                    │  │ ML  │  │                    │  │ ML  │  │
   │  └─────┘ │                    │  │Mob. │  │                    │  └─────┘  │
   │          │                    │  └─────┘  │                    │           │
   └──────────┘                    └───────────┘                    └───────────┘

   ┌──────────────────────────────────────────────────────────────────────┐
   │                                                                      │
   │   Events emitted                                                     │
   │                                                                      │
   │   t=1:  evt-001  capability_proposed  mobile_app_development         │
   │   t=1:  evt-002  capability_promoted  mobile_app_development        │
   │   t=1:  evt-003  capability_promoted  mobile_app_development        │
   │   t=1:  evt-004  agent_born           bp-mobile_app_development-v1   │
   │   t=1:  evt-005  team_optimized       hint-001                       │
   │                                                                      │
   │   t=2:  evt-006  agent_retired        bp-legacy_pdf_parser-v1        │
   │          └─ reason: low_score (avgScore=2.3 < 4.0)                   │
   │   t=2:  evt-007  team_optimized       hint-002 (parallelize)         │
   │                                                                      │
   └──────────────────────────────────────────────────────────────────────┘
```

## Replay the Org State at Time `t`

```typescript
const events = await orgMemory.listAll();
const beforeT = events.filter((e) => e.at <= t);

// Replay:
//   1. Apply capability_proposed → create
//   2. Apply capability_promoted → status transition
//   3. Apply agent_born → add to registry
//   4. Apply agent_retired → mark retiredAt
//   5. Apply team_optimized → log hint
//   6. Apply governance_violation → record

const state = reconstructOrgState(beforeT);
// state.activeCapabilities: number
// state.activeAgents: number
// state.retiredAgents: number
// state.hints: TeamOptimizerHint[]
// state.violations: GovernanceVerdict[]
```

## Cycle Outcome Distribution

```
After N cycles, the org events file distribution:

capability_proposed:    12
capability_promoted:    24  (twice per capability — proposed→exp, exp→active)
capability_deprecated:   3
capability_retired:      2
agent_born:             12
agent_retired:           4
agent_merged:            0
agent_split:             1
team_optimized:         18  (one per cycle)
governance_violation:    1
```

## Metrics Over Time

```
Average agents:        6.2 (over 30 cycles)
Average capabilities:  8.4
Average birth rate:    0.4 per cycle
Average retire rate:   0.13 per cycle
Governance violations: 0.033 per cycle (1 in 30)
```

## What This Means

The organization **grows by ~0.27 agents per cycle** on average. Retirement rate is ~3x lower than birth rate. Governance violations are rare (3.3%), indicating the limits are conservative.

To slow growth: lower `maxAgents` or raise `minProposalEvidence`.
To speed churn: lower `minUsageToKeep` or raise `mergeScoreThreshold`.