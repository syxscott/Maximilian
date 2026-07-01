# ADR-019: Dedicated `meta-system` Package

**Status**: Accepted
**Date**: 2026-06-22
**Phase**: 6

## Context

Phase 5 closed the agent-level loop (observe → review → plan → candidate → promotion), but the organization itself was static: capabilities and agents only changed through manual edits or evolution plans.

Phase 6 introduces a **meta-system** that operates one level above agents — it observes the organization, proposes new capabilities, births/retires agents, and reorganizes teams.

The meta-system touches multiple domains (capability management, agent lifecycle, org memory, governance, simulation). It needs to:

- Have its own lifecycle (so it can be turned on/off without affecting Phase 1-5)
- Be tested independently of `@max/api`
- Expose a clean public API that the API layer wires into `/api/meta/*`

## Decision

Create a new workspace package `@max/meta-system` with:

```
packages/meta-system/
├── src/
│   ├── types.ts                     # All Phase 6 schemas
│   ├── capability-discovery.ts      # 6.1
│   ├── capability-registry.ts       # 6.2
│   ├── meta-agent.ts                # 6.3
│   ├── team-optimizer.ts            # 6.4
│   ├── agent-birth.ts               # 6.5
│   ├── agent-retirement.ts          # 6.6
│   ├── organization-memory.ts       # 6.7
│   ├── simulation.ts                # 6.8
│   ├── governance.ts                # 6.9
│   ├── orchestrator.ts              # 6.X — ties them together
│   └── index.ts
└── test/meta-unit.test.ts           # 71 unit tests
```

The package depends on `@max/dags` (for `AgentBlueprint`/`TeamGraph`) and `@max/autonomy` (for `ExecutionRecord`), but **not** on `@max/api` or `@max/evolution`. The meta-system is a higher-level consumer, not a peer of the agent runtime.

## Consequences

**正面**：
- Clean separation: meta-system vs agent system
- Easy to enable/disable at runtime via `META_AGENT_ENABLED`
- Tests run in isolation (71 unit tests in 45ms)

**负面**：
- New package to maintain
- Cross-package types (`TeamGraph`, `ExecutionRecord`) create coupling, but they are stable contracts (ADR-013, ADR-015)