# Agent Lifecycle Diagram (Phase 6)

```
   ┌───────────────────────────────────────────────────────────────────┐
   │                                                                   │
   │  CapabilityDiscoveryEngine                                        │
   │        │                                                          │
   │        │ "Build iOS app" × 3                                      │
   │        ▼                                                          │
   │   ┌──────────────┐                                                │
   │   │   PROPOSAL   │ (immutable)                                    │
   │   │              │                                                │
   │   └──────┬───────┘                                                │
   │          │ cycle()                                                │
   │          ▼                                                        │
   │   CapabilityRegistry.propose()                                    │
   │          │                                                        │
   │          │ status="proposed"                                      │
   │          ▼                                                        │
   │   ┌──────────────┐                                                │
   │   │  REGISTERED  │                                                │
   │   │  (proposed)  │                                                │
   │   └──────┬───────┘                                                │
   │          │ cycle()                                                │
   │          ▼                                                        │
   │   ┌──────────────┐                                                │
   │   │  ACTIVATED   │ (active capability)                            │
   │   │  (active)    │                                                │
   │   └──────┬───────┘                                                │
   │          │ AgentBirthEngine.birth()                               │
   │          ▼                                                        │
   │   ┌──────────────┐                                                │
   │   │    BORN      │ ────► BlueprintStore (live)                    │
   │   │  (blueprint) │ ────► agent-births/<id>.json (audit)           │
   │   └──────┬───────┘                                                │
   │          │ DAGS picks up by role                                  │
   │          ▼                                                        │
   │   ┌──────────────┐                                                │
   │   │   ACTIVE     │ ◄─── ExecutionStore.record() per run           │
   │   │  (executes)  │      ┌────────────────────────┐               │
   │   │              │ ────►│ execution: score, ms   │               │
   │   │              │      └────────────────────────┘               │
   │   └──────┬───────┘                                                │
   │          │ AgentRetirementEngine.evaluate()                       │
   │          │                                                        │
   │          ▼                                                        │
   │   ┌──────────────┐                                                │
   │   │  DEPRECATED  │ (still queryable, low usage)                   │
   │   └──────┬───────┘                                                │
   │          │                                                        │
   │          ▼                                                        │
   │   ┌──────────────┐                                                │
   │   │   RETIRED    │ ────► blueprint.retiredAt set                  │
   │   │  (terminal)  │      (kept in BlueprintStore for forensics)   │
   │   └──────────────┘                                                │
   │                                                                   │
   └───────────────────────────────────────────────────────────────────┘
```

## Birth Audit Trail

```
agent-births/bp-mobile_app_development_agent-v1-abc123.json:
{
  "blueprintId": "bp-mobile_app_development_agent-v1-abc123",
  "role": "mobile_app_development_agent",
  "displayName": "Mobile App Development",
  "systemPrompt": "# Mobile App Development Agent\n...",
  "capabilities": ["mobile_app_development"],
  "constraints": { "outputFormat": "code" },
  "version": "v1",
  "parentCapability": "mobile_app_development",
  "createdAt": "2026-06-22T17:00:00Z"
}
```

## Retirement Decision

```
RetirementDecision:
{
  "blueprintId": "bp-legacy_pdf_parser-v1-xyz",
  "role": "legacy_pdf_parser_agent",
  "reason": "low_score",                      // or "low_usage"
  "metrics": {
    "usageCount": 5,
    "avgScore": 2.3,                           // < 4.0 → retire
    "sampleSize": 5
  },
  "decidedAt": "2026-06-22T17:30:00Z"
}
```

## Live → Retired Flow

```
1. Blueprint is born (AgentBirthEngine)
2. DAGS.compose() picks it up by role
3. Runtime executes, ExecutionStore.record() per run
4. AgentRetirementEngine.evaluate() runs on each cycle
5. If low_score / low_usage → RetirementDecision emitted
6. Optional retireBlueprint(id) callback marks blueprint.retiredAt
7. orgMemory.record("agent_retired", ...) for audit
8. Blueprint remains in BlueprintStore (retiredAt set, never deleted)
```