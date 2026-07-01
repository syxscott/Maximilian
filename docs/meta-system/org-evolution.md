# Organization Evolution

The organization is not static. It evolves through a series of **cycles**, each one observing the current state and proposing changes. This document describes how that evolution is observable and replayable.

## Event Types

Every change is recorded as one of these `OrgEventType` values:

| Type | Subject | Payload |
|------|---------|---------|
| `capability_proposed` | `capabilityId` | `{ proposalId, source }` |
| `capability_promoted` | `capabilityId` | `{ from, to }` |
| `capability_deprecated` | `capabilityId` | `{ from, to }` |
| `capability_retired` | `capabilityId` | `{ from, to }` |
| `agent_born` | `blueprintId` | `{ role, capability }` |
| `agent_retired` | `blueprintId` | `{ role, reason }` |
| `agent_merged` | `role` | `{ target: role }` |
| `agent_split` | `role` | `{ target: role }` |
| `team_optimized` | `hintId` | `{ suggestions, estimatedCost }` |
| `governance_violation` | `"system"` | `{ reason }` |

## Evolution Sequence (Example)

Imagine three cycles in a row.

### Cycle 1: Discovery + Birth

```
signal: "Build iOS app"
        │
        ▼
evt-001  capability_proposed  mobile_app_development
evt-002  capability_promoted  mobile_app_development (proposed → experimental)
evt-003  capability_promoted  mobile_app_development (experimental → active)
evt-004  agent_born           bp-mobile_app_development_agent-v1-aaa
evt-005  team_optimized       hint-001 (adds review node)
```

### Cycle 2: Failure Detection + Retirement

```
execution: avgScore=2.3, usageCount=1
        │
        ▼
evt-006  agent_retired        bp-legacy_pdf_parser-v1-bbb (low_score)
```

### Cycle 3: Team Optimization

```
graph: serial chain, avg latency 45000ms
        │
        ▼
evt-007  team_optimized       hint-002 (parallelize suggestion)
evt-008  governance_violation system (maxDepth exceeded, depth=5)
```

## Replayability

Given the append-only log, we can reconstruct:

```
1. When was each capability born?
   orgMemory.timeline("mobile_app_development")
   → evt-001, evt-002, evt-003, evt-004

2. How many governance violations in the last 30 days?
   orgMemory.listAll().filter(e => e.type === "governance_violation")

3. What was the org state on 2026-06-15?
   orgMemory.listAll().filter(e => e.at <= "2026-06-15T23:59:59Z")
   → reconstruct by replaying each event

4. Most active roles?
   orgMemory.countByType()  // events per type
   orgMemory.listAll().groupBy(e => e.subject)
```

## Cycle Outcome

After each cycle, `MetaCycleResult` contains:

```ts
{
  proposals: CapabilityProposal[],          // newly discovered
  activated: CapabilityRecord[],            // promoted to active
  births: AgentBirthResult[],               // agents materialized
  retirements: RetirementDecision[],        // agents retired
  changePlan: AgentChangePlan,              // MetaAgent decisions
  teamHint: TeamOptimizerHint,              // TeamOptimizer suggestions
  governance: GovernanceVerdict,            // limits check
  recorded: number                          // events recorded
}
```

## Why Append-Only?

Three reasons:

1. **No silent overwrites** — once an event is recorded, it stays.
2. **Replayable** — given events, we can rebuild the org state at any point in time.
3. **Debuggable** — `grep` over `org-events/` answers most forensic questions.

The trade-off is storage growth, mitigated in the future by an archival policy (e.g., move events older than 1 year to cold storage).

## Visualization

To see the org evolution as a timeline:

```bash
ls org-events/ | sort | while read f; do
  cat "org-events/$f" | jq -r '"\(.at)  \(.type)  \(.subject)"'
done
```

Output:

```
2026-06-22T17:00:00Z  capability_proposed  mobile_app_development
2026-06-22T17:00:01Z  capability_promoted  mobile_app_development
2026-06-22T17:00:02Z  agent_born           bp-mobile_app_development_agent-v1-aaa
2026-06-22T17:05:00Z  capability_proposed  blockchain_development
2026-06-22T17:05:01Z  agent_born           bp-blockchain_development_agent-v1-bbb
2026-06-22T17:10:00Z  agent_retired        bp-legacy_pdf_parser-v1-ccc
2026-06-22T17:15:00Z  team_optimized       hint-001
```