# Meta-System Architecture

The meta-system is a closed loop that runs **one level above** the agent runtime. It has three layers:

```
┌──────────────────────────────────────────────────────────────────┐
│                       OBSERVATION LAYER                          │
│                                                                  │
│   DiscoverySignals              ExecutionStats                   │
│   (text, context, source)       (per-role: avgScore, duration)   │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                       DECISION LAYER                             │
│                                                                  │
│   CapabilityDiscovery → Registry → Birth → Retirement            │
│                                                                  │
│   MetaAgent (create/delete/merge/split)                          │
│   TeamOptimizer (add_review/parallelize/grow_team/...)           │
│   GovernanceEngine (maxAgents/maxCapabilities/maxDepth)          │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                       PERSISTENCE LAYER                           │
│                                                                  │
│   capability-registry/<id>.json                                  │
│   capability-proposals/<id>.json                                 │
│   agent-births/<blueprintId>.json                                │
│   org-events/<eventId>.json                                      │
│   governance-config.json                                         │
└──────────────────────────────────────────────────────────────────┘
```

## Data Flow (one cycle)

```
   user request / failure / review
                │
                ▼
   DiscoverySignal[]  ──────────────────────────────────┐
                │                                       │
                ▼                                       │
   CapabilityDiscoveryEngine                            │
     • match KNOWN_KEYWORDS → skip                      │
     • match GAP_PATTERNS   → accumulate                │
     • if frequency ≥ 2 → CapabilityProposal            │
                │                                       │
                ▼                                       │
   CapabilityRegistry.propose()                         │
     • if id already exists → skip                      │
     • status = "proposed"                              │
                │                                       │
                ▼                                       │
   MetaOrchestrator.cycle()                             │
     • promote proposed → experimental                  │
     • promote experimental → active                    │
                │                                       │
                ▼                                       │
   AgentBirthEngine.birth()                             │
     • derive role = ${capabilityId}_agent              │
     • compose systemPrompt                             │
     • save blueprint (via callback)                    │
     • write audit file                                 │
                │                                       │
                ▼                                       │
   MetaAgent.decide()                                   │
     • create: proposals with evidence ≥ 3              │
     • delete: retirement decisions                     │
     • merge:  low-score pairs                          │
     • split:  high-latency roles                       │
                │                                       │
                ▼                                       │
   TeamOptimizer.suggest() ─────────────────────────────┤
                │                                       │
                ▼                                       │
   GovernanceEngine.check()                             │
     • maxAgents (20)                                   │
     • maxCapabilities (30)                             │
     • maxDepth (4)                                     │
                │                                       │
                ▼                                       │
   OrganizationMemory.record(...)  ◄────────────────────┘
     • one JSON file per event
     • queryable by subject
```

## Module Dependency Graph

```
            ┌──────────────────┐
            │  MetaOrchestrator│  ←── API + E2E entry point
            └────────┬─────────┘
                     │
        ┌────────────┼────────────┬────────────┬────────────┐
        ▼            ▼            ▼            ▼            ▼
   Discovery    Registry       Birth      Retirement    MetaAgent
        │            │            │            │            │
        └────────────┼────────────┴────────────┘            │
                     │                                     │
                     │       ┌─────────────────────────────┘
                     │       │
                     ▼       ▼
                TeamOptimizer   OrganizationMemory
                                   │
                     ┌─────────────┘
                     ▼
              GovernanceEngine

External dependencies (cross-package):
   • @max/dags     — TeamGraph, AgentBlueprint
   • @max/autonomy — ExecutionRecord, StructuredReview
```

## Storage Layout

```
<rootDir>/
├── capability-registry/
│   ├── frontend.json             # active
│   ├── backend.json              # active
│   └── mobile_app_development.json # active (born in cycle 1)
├── capability-proposals/
│   └── prop-abc12345.json        # historical proposals (immutable)
├── agent-births/
│   ├── bp-mobile_app_development_agent-v1-xyz.json
│   └── bp-blockchain_development_agent-v1-abc.json
├── org-events/
│   ├── evt-aaa11111.json         # capability_proposed
│   ├── evt-bbb22222.json         # capability_promoted
│   ├── evt-ccc33333.json         # agent_born
│   └── evt-ddd44444.json         # team_optimized
└── governance-config.json        # hot-reloadable
```

## Threading & Concurrency

The meta-system is **synchronous within a single cycle** but cycles are independent:

- One `cycle()` call → all 7 steps run sequentially on the same node thread
- No internal locking (assumes single-cycle invocation per workspace)
- File writes are atomic via `fs.writeFile()` (single shot per file)

For concurrent cycle invocation, callers must serialize — the system does not currently handle parallel cycles.

## Performance

Measured on a single cycle with empty input:

| Operation | Time |
|-----------|------|
| 71 unit tests | ~45ms |
| 10 integration tests | ~25ms |
| 7 E2E tests | ~35ms |

The whole package (unit + integration + E2E) runs in ~300ms.