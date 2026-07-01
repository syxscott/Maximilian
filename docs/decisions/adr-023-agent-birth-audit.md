# ADR-023: AgentBirth Writes Audit + Optional Blueprint Callback

**Status**: Accepted
**Date**: 2026-06-22
**Phase**: 6

## Context

When a new capability is activated, we need to materialize a blueprint (AgentBirthResult) that:

1. Becomes a registered agent (available for `DAGS.compose`)
2. Is auditable (which capabilities birthed which agents)
3. Does not bypass the existing `BlueprintStore` (which is the source of truth for active blueprints)

## Decision

`AgentBirthEngine.birth()` produces an `AgentBirthResult`:

```ts
{
  blueprintId: "bp-mobile_app_development_agent-v1-abc123",
  role: "mobile_app_development_agent",
  displayName: "Mobile App Development",
  systemPrompt: "...",
  capabilities: ["mobile_app_development"],
  constraints: { outputFormat: "code" },
  version: "v1",
  parentCapability: "mobile_app_development",
  createdAt: "..."
}
```

It then:

1. Calls optional `saveBlueprint(blueprint)` callback (so the consumer can persist to its own `BlueprintStore`)
2. Writes the birth to `<rootDir>/agent-births/<blueprintId>.json` for audit

The audit file is append-only and queryable separately from the live `BlueprintStore`.

## Consequences

**正面**：
- Consumer controls persistence (`BlueprintStore` schema respected)
- Audit trail captures every birth (compliance + debugging)
- Births can be replayed (re-run birth with same proposal → same blueprintId pattern)

**负面**：
- Callback contract adds a layer of indirection
- Audit files accumulate (mitigation: rotation policy in future)