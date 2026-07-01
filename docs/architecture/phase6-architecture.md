# Phase 6 Architecture — Meta-System

```
                        ┌───────────────────────────────────────┐
                        │           USER REQUEST                │
                        │  "Build a mobile app with Swift"      │
                        └───────────────────┬───────────────────┘
                                            │
                                            ▼
        ┌───────────────────────────────────────────────────────────────┐
        │                       @max/api                                 │
        │                                                               │
        │   POST /api/chat  ─────►  (DAGS_MODE)  DAGS.compose()         │
        │                                              │                │
        │                                              ▼                │
        │                                       AgentRuntime              │
        │                                              │                │
        │                                              ▼                │
        │                                  AutonomyOrchestrator.observe()│
        │                                              │                │
        │   POST /api/meta/cycle ──►  MetaOrchestrator.cycle()           │
        │                                              │                │
        │   GET  /api/meta/events ─► OrganizationMemory                  │
        │   POST /api/meta/simulate ► SimulationEngine                   │
        │   POST /api/meta/governance/check ► GovernanceEngine           │
        └──────────────────────────────┬────────────────────────────────┘
                                       │
        ┌──────────────────────────────▼──────────────────────────────┐
        │                    @max/meta-system                          │
        │                                                              │
        │  ┌────────────┐  ┌─────────────┐  ┌────────────┐  ┌────────┐ │
        │  │ Discovery  │─►│  Registry   │─►│   Birth    │─►│ Memory │ │
        │  └────────────┘  └─────────────┘  └────────────┘  └────────┘ │
        │        │                │                │              ▲    │
        │        │                │                │              │    │
        │        ▼                ▼                ▼              │    │
        │  ┌────────────┐  ┌─────────────┐  ┌────────────┐  ┌────────┐ │
        │  │ Proposals  │  │ Capabilities│  │  Births    │  │ Events │ │
        │  └────────────┘  └─────────────┘  └────────────┘  └────────┘ │
        │                                                              │
        │  ┌────────────┐  ┌─────────────┐  ┌────────────┐  ┌────────┐ │
        │  │ Retirement │  │  MetaAgent  │  │TeamOptimize│  │Govern  │ │
        │  └────────────┘  └─────────────┘  └────────────┘  └────────┘ │
        │        │                │                │              │    │
        │        └────────────────┴────────────────┴──────────────┘    │
        └──────────────────────────────────────────────────────────────┘
                                       │
        ┌──────────────────────────────▼──────────────────────────────┐
        │                  File-based persistence                      │
        │   capability-registry/  capability-proposals/                 │
        │   agent-births/         org-events/                          │
        │   governance-config.json                                      │
        └──────────────────────────────────────────────────────────────┘
                                       │
        ┌──────────────────────────────▼──────────────────────────────┐
        │                  Cross-package contracts                     │
        │   @max/dags:     TeamGraph, AgentBlueprint                    │
        │   @max/autonomy: ExecutionRecord, StructuredReview            │
        └──────────────────────────────────────────────────────────────┘
```

## Component Map

```
MetaOrchestrator.cycle(input)
   │
   ├── 1. CapabilityDiscoveryEngine.discover(signals, knownIds)
   │      └── writes: capability-proposals/<id>.json
   │
   ├── 2. CapabilityRegistry.propose()  for each new proposal
   │      └── writes: capability-registry/<id>.json
   │
   ├── 3. Auto-promotion: proposed → experimental → active
   │
   ├── 4. AgentBirthEngine.birth()  for each activated capability
   │      ├── calls saveBlueprint()  →  consumer's BlueprintStore
   │      └── writes: agent-births/<blueprintId>.json
   │
   ├── 5. AgentRetirementEngine.evaluateAll(activeBlueprintIds, executions)
   │      └── emits RetirementDecision[] (no writes)
   │
   ├── 6. MetaAgent.decide({ capabilities, retirements, proposals, stats })
   │      └── emits AgentChangePlan (no writes)
   │
   ├── 7. TeamOptimizer.suggest({ graph, executions })
   │      └── emits TeamOptimizerHint (no writes)
   │
   ├── 8. GovernanceEngine.check({ graphs, capabilities, blueprints })
   │      └── emits GovernanceVerdict (no writes)
   │
   └── 9. OrganizationMemory.record(type, subject, payload)  for each step
          └── writes: org-events/<evt-id>.json
```

## Data Flow

```
                INPUT                              OUTPUT
            ┌─────────┐                        ┌──────────┐
            │ Signals │                        │ Proposals│
            │ Execs   │                        │ Births   │
            │ Graphs  │      cycle()           │ Retires  │
            │ BPs     │ ─────────────►         │ Plans    │
            └─────────┘                        │ Hints    │
                                              │ Verdicts │
                                              │ Events   │
                                              └──────────┘
```

## Layering

| Layer | Package | Phase |
|-------|---------|-------|
| API | `@max/api` | 1, 5, 6 |
| Meta-system | `@max/meta-system` | 6 |
| Agent runtime | `@max/dags`, `@max/autonomy` | 2, 5 |
| Core | `@max/core`, `@max/workspace` | 1 |

The meta-system is a **higher-level consumer** of the agent runtime. It does not modify the runtime itself — it only emits decisions and events.