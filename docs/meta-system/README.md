# Maximilian Meta-System (Phase 6)

The meta-system is the self-organizing layer that sits **above** the agent runtime. It observes the organization's behavior, proposes new capabilities, births new agents, retires underperforming ones, and reorganizes teams — all while preserving an immutable audit trail.

## What Phase 6 Delivers

| Sub-phase | Component | Responsibility |
|-----------|-----------|----------------|
| 6.1 | `CapabilityDiscoveryEngine` | Mine signals (user requests, failures, reviews) for missing capabilities |
| 6.2 | `CapabilityRegistry` | Lifecycle: proposed → experimental → active → deprecated → retired |
| 6.3 | `MetaAgent` | Decide create / delete / merge / split for agents |
| 6.4 | `TeamOptimizer` | Suggest team adjustments (add review, parallelize, grow, etc.) |
| 6.5 | `AgentBirthEngine` | Materialize blueprints for newly active capabilities |
| 6.6 | `AgentRetirementEngine` | Retire agents with low usage / low score |
| 6.7 | `OrganizationMemory` | Append-only event log of all org changes |
| 6.8 | `SimulationEngine` | Offline cost / latency / quality / risk prediction |
| 6.9 | `GovernanceEngine` | Hard limits (max agents, capabilities, depth) |
| 6.X | `MetaOrchestrator` | One full cycle = discover → activate → birth → retire → decide → optimize → govern |

## Activation

```bash
# .env
META_AGENT_ENABLED=true
```

With `META_AGENT_ENABLED=true`, the API server boots the `MetaOrchestrator` and exposes:

```
GET    /api/meta/capabilities
GET    /api/meta/capabilities/:id
GET    /api/meta/proposals
POST   /api/meta/cycle
GET    /api/meta/events
GET    /api/meta/events/count
POST   /api/meta/governance/check
POST   /api/meta/simulate
POST   /api/meta/simulate/compare
GET    /api/meta/governance/config
PUT    /api/meta/governance/config
```

With `META_AGENT_ENABLED` unset or `false`, none of these endpoints are mounted, and the meta-system costs zero at runtime.

## High-Level Architecture

```
                    ┌──────────────────────────────────────────────┐
                    │              MetaOrchestrator                │
                    │  cycle(input) → MetaCycleResult               │
                    └───────┬─────────────┬───────────┬─────────────┘
                            │             │           │
            ┌───────────────▼─┐  ┌────────▼─────┐  ┌─▼─────────────┐
            │  Discovery      │  │  Registry    │  │  Birth        │
            │  (signal mine)  │  │  (lifecycle) │  │  (blueprint)  │
            └────────┬────────┘  └──────┬───────┘  └──┬────────────┘
                     │                  │              │
            ┌────────▼────────┐  ┌──────▼───────┐  ┌──▼─────────────┐
            │  Proposals      │  │  Capability  │  │  Births audit  │
            │  <proposals>.json│  │  <id>.json   │  │  <bp-id>.json  │
            └─────────────────┘  └──────────────┘  └────────────────┘

            ┌───────────────┐  ┌──────────────┐  ┌─────────────────┐
            │  Retirement   │  │  MetaAgent   │  │  TeamOptimizer  │
            │  (lookback)   │  │  (decide)    │  │  (hints)        │
            └───────┬───────┘  └──────┬───────┘  └────────┬────────┘
                    │                 │                   │
                    └─────────────────┼───────────────────┘
                                      │
                          ┌───────────▼──────────┐
                          │  Governance (limits) │
                          └───────────┬──────────┘
                                      │
                          ┌───────────▼──────────┐
                          │ OrganizationMemory   │
                          │ (append-only log)    │
                          └──────────────────────┘
```

## One Cycle in Detail

```
INPUT: { discoverySignals, blueprints, graphs, recentExecutions }

1. DISCOVER
   discovery.discover(signals, knownIds) → CapabilityProposal[]

2. PROPOSE
   for each proposal:
     registry.propose(...)  // status: "proposed"
     orgMemory.record("capability_proposed", ...)

3. ACTIVATE
   for each capability in registry.listAll():
     if status="proposed"  → transition to "experimental"  + orgMemory
     if status="experimental" → transition to "active"     + orgMemory
     activated.push(c)

4. BIRTH
   for each activated capability:
     birth.birth(c) → AgentBirthResult  // blueprint + audit
     orgMemory.record("agent_born", ...)

5. RETIRE
   retirement.evaluateAll(activeBlueprintIds, executions) → RetirementDecision[]
   for each decision:
     orgMemory.record("agent_retired", ...)

6. META-DECIDE
   metaAgent.decide({ capabilities, retirements, proposals, executionStats })
     → AgentChangePlan { decisions: create/delete/merge/split }
   for each decision:
     orgMemory.record(decision.action, ...)

7. TEAM OPTIMIZE
   teamOptimizer.suggest({ graph, executions }) → TeamOptimizerHint
   orgMemory.record("team_optimized", ...)

8. GOVERN
   governance.check({ graphs, capabilities, blueprints }) → GovernanceVerdict
   if !allowed:
     orgMemory.record("governance_violation", "system", { reason })

OUTPUT: MetaCycleResult { proposals, activated, births, retirements,
                          changePlan, teamHint, governance, recorded }
```

See also:

- [architecture.md](architecture.md) — Detailed architecture & data flow
- [capability-lifecycle.md](capability-lifecycle.md) — 5-state lifecycle state machine
- [agent-lifecycle.md](agent-lifecycle.md) — Birth → use → retire flow
- [org-evolution.md](org-evolution.md) — How the organization evolves over cycles
- [api-reference.md](api-reference.md) — HTTP API reference