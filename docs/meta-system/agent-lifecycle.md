# Agent Lifecycle

An **agent** is the *who* of the organization — a blueprint with a role, capabilities, system prompt, and constraints. Agents are born from capabilities and retired when they no longer serve traffic.

## Lifecycle States

```
        ┌──────────────┐
        │   PROPOSED   │  ← CapabilityDiscoveryEngine
        │ (signal min) │
        └──────┬───────┘
               │ cycle()
               ▼
        ┌──────────────┐
        │  REGISTERED  │  ← CapabilityRegistry.propose()
        │(proposed)    │
        └──────┬───────┘
               │ cycle()
               ▼
        ┌──────────────┐
        │   BORN       │  ← AgentBirthEngine.birth()
        │(blueprint)   │
        └──────┬───────┘
               │
               ▼
        ┌──────────────┐
        │   ACTIVE     │  ← serving traffic via DAGS
        │(executes)    │
        └──────┬───────┘
               │
       ┌───────┴────────┐
       │                │
       ▼                ▼
  ┌─────────┐      ┌──────────────┐
  │ RETIRED │      │  DEPRECATED  │
  │(terminal)│     │ (still alive)│
  └─────────┘      └──────┬──────┘
                          │ retire
                          ▼
                     ┌─────────┐
                     │ RETIRED │
                     └─────────┘
```

## Birth → Use → Retire

### 1. Birth

`AgentBirthEngine.birth(capability)` produces:

```ts
{
  blueprintId: "bp-mobile_app_development_agent-v1-abc123",
  role: "mobile_app_development_agent",
  displayName: "Mobile App Development",
  systemPrompt: "# Mobile App Development Agent\n\nYou are the Mobile App Development...",
  capabilities: ["mobile_app_development"],
  constraints: { outputFormat: "code" },
  version: "v1",
  parentCapability: "mobile_app_development",
  createdAt: "2026-06-22T17:00:00Z"
}
```

It then:

1. Calls `saveBlueprint(blueprint)` callback (consumer persists to `BlueprintStore`)
2. Writes audit file to `<rootDir>/agent-births/<blueprintId>.json`

### 2. Use

Active blueprints are picked up by `DAGS.compose()` based on capability match. Each execution records:

```ts
{
  agentRole: "mobile_app_development_agent",
  blueprintId: "bp-mobile_app_development_agent-v1-abc123",
  review: { score: 8.5, ... },
  durationMs: 3000,
  status: "completed"
}
```

`ExecutionStore` aggregates these for retirement evaluation.

### 3. Retirement

`AgentRetirementEngine.evaluate(blueprintId, role, executions)` checks:

| Reason | Condition |
|--------|-----------|
| `low_usage` | `usageCount < 2` (lookback 100) |
| `low_score` | `avgScore < 4.0` |
| `capability_retired` | parent capability status === `retired` |
| `replaced_by_newer` | a higher-version blueprint exists for same role |
| `manual` | (future: human override) |

When retired:

1. `retireBlueprint(id)` callback fires (consumer marks `blueprint.retiredAt`)
2. `orgMemory.record("agent_retired", id, { role, reason })`

The blueprint is **never deleted** — it remains in `BlueprintStore` with `retiredAt` set, available for forensics.

## Role Derivation

The `role` is derived deterministically from `capabilityId`:

```
mobile_app_development → mobile_app_development_agent
blockchain_development → blockchain_development_agent
data_science           → data_science_agent
```

This ensures that the same capability always produces the same role name, making `DAGS.compose()` routing predictable.

## Versioning

New versions of the same role (e.g., from `EvolutionPlanner` in Phase 5) are tracked as separate blueprints:

```
bp-mobile_app_development_agent-v1-abc123  # initial
bp-mobile_app_development_agent-v2-def456  # improved systemPrompt
```

The meta-system only retires **whole blueprints**, not versions within a role. Version evolution is `EvolutionPlanner`'s job (Phase 5).