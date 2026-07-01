# Phase 7 — Architecture: Self-Evolving System

**Date**: 2026-06-22
**Phase**: 7 — Meta-System Activation

---

## Goal

Convert Maximilian from a **self-describing** system (Phase 6.5) into a **self-evolving** system. After each user request, the system autonomously:

1. Observes the result
2. Discovers new capabilities from patterns
3. Registers & activates them
4. Births new agents
5. Persists blueprints to disk
6. Updates DAGS's capability library on the next compose
7. Materializes team-optimizer hints into blueprint metadata
8. Hard-blocks mutations that exceed governance limits
9. Retires under-performing agents
10. Records the entire event timeline

---

## Architecture Diagram

```
                            USER REQUEST
                                 │
                                 ▼
                          @max/api (Hono)
                                 │
              ┌──────────────────┼──────────────────────────┐
              │                  │                          │
              ▼                  ▼                          ▼
       POST /api/chat    POST /api/meta/cycle        GET /api/meta/*
              │                  ▲                          │
              │                  │                          │
              ▼                  │                          │
       ┌─────────────┐    ┌──────┴──────────────┐          │
       │   DAGS       │    │ MetaOrchestrator   │          │
       │ .compose()   │    │ .cycle()           │          │
       └──────┬───────┘    └──────┬──────────────┘          │
              │                   │                          │
              │            ┌──────┼──────┬──────────┐       │
              │            ▼      ▼      ▼          ▼       │
              │      Discovery Birth Retirement MetaAgent    │
              │            │      │          │         │     │
              │            ▼      ▼          ▼         ▼     │
              │      ┌──────────────────────────────────┐     │
              │      │  CapabilityRegistry (lifecycle)  │     │
              │      │  proposed→experimental→active   │     │
              │      └──────────────┬───────────────────┘     │
              │                     │                         │
              │                     ▼ (syncDynamicCapabilities)
              │      ┌──────────────────────────────────┐     │
              │      │  CapabilityLibrary               │◄────┘
              │      │  (static + dynamic = replaceDynamic)
              │      └──────────────┬───────────────────┘
              │                     │
              ▼                     ▼
       ┌────────────────────────────────────┐
       │  BlueprintStore (shared)            │ ◄── shared between DAGS
       │  workspace/blueprints/<id>.json    │     and meta-system
       │  workspace/blueprints/<id>.json    │
       │   (retiredAt = ISO when retired)    │
       └──────────────┬─────────────────────┘
                      │
                      ▼
              AgentRuntime → done event
                      │
                      ▼
       AutonomyOrchestrator.observe() (Phase 5)
                      │
                      ▼ (Phase 7 — auto-trigger)
       MetaOrchestrator.cycle()  ◄── closed loop
                      │
                      ├─ CapabilityDiscovery.discover()
                      ├─ CapabilityRegistry.propose()/transition()
                      ├─ AgentBirthEngine.birth() → saveBlueprint → BlueprintStore.save
                      ├─ AgentRetirementEngine.evaluateAll() → retireBlueprint → BlueprintStore.retire
                      ├─ TeamOptimizer.suggest() → applyHint → applyHintToBlueprints → BlueprintStore.save
                      ├─ GovernanceEngine.check() → block mutations if not allowed
                      └─ OrganizationMemory.record() for every step
```

---

## Data Flow Diagram

```
User Request
    │
    ▼
┌──────────────┐         ┌─────────────────────┐
│ Workspace    │────────►│ ExecutionRecord[]   │
│ (results,    │         │ (per-task)          │
│  plan,       │         └──────────┬──────────┘
│  review)     │                    │
└──────┬───────┘                    ▼
       │                  ┌──────────────────────┐
       │                  │ AutonomyOrchestrator │
       │                  │ .observe()           │
       │                  └──────────┬───────────┘
       │                             │
       │                             ▼
       │                  ┌──────────────────────┐
       │                  │ runtime.on("done")   │
       │                  │ → meta-cycle trigger │
       │                  └──────────┬───────────┘
       │                             │
       │                             ▼
       │                  ┌──────────────────────┐
       │                  │ MetaOrchestrator     │
       │                  │ .cycle(input)        │
       │                  └──────────┬───────────┘
       │                             │
       │      ┌──────────────────────┼─────────────────────┐
       │      ▼                      ▼                     ▼
       │  DiscoverySignals    recentExecutions     blueprints + graphs
       │      │                      │                     │
       │      ▼                      │                     │
       │  CapabilityRegistry.listAll()                    │
       │  + .discover()                                  │
       │      │                                          │
       │      ▼                                          │
       │  proposals[]                                    │
       │      │                                          │
       │      ▼                                          │
       │  registry.propose()                             │
       │  registry.transition()                          │
       │      │                                          │
       │      ▼                                          │
       │  activated[]                                    │
       │      │                                          │
       │      ▼                                          │
       │  birth.birth()                                  │
       │      │                                          │
       │      ▼                                          │
       │  saveBlueprint(bp) ────► BlueprintStore.save() │
       │                                  │              │
       │                                  ▼              │
       │                       blueprints/<id>.json     │
       │                                  │              │
       │                                  ▼              │
       │                       retire evaluate           │
       │                                  │              │
       │                                  ▼              │
       │                       retireBlueprint(id) ─────►
       │                                  │
       │                                  ▼
       │                       BlueprintStore.retire()
       │                                  │
       │                                  ▼
       │                       blueprint.retiredAt = now
       │                                  │
       │                                  ▼
       │                       TeamOptimizer.suggest()
       │                                  │
       │                                  ▼
       │                       applyHint(hint)
       │                                  │
       │                                  ▼
       │                       applyHintToBlueprints()
       │                                  │
       │                                  ▼
       │                       BlueprintStore.save() (metadata flags)
       │                                  │
       │                                  ▼
       │                       GovernanceEngine.check()
       │                                  │
       │                                  ▼
       │                       OrganizationMemory.record()
       │                                  │
       │                                  ▼
       │                       /api/meta/* events JSON
       │
       ▼
Next /api/chat
       │
       ▼
DAGS.compose() {
  await syncDynamicCapabilities()         ◄── Phase 7
  library.replaceDynamic(activeCaps)       ◄── Phase 7
  library.detectByKeywords(userRequest)    ◄── now sees new capabilities
  library.get("data_pipeline") → Capability ◄── BlueprintStore.get(<born>)
  ...
}
```

---

## Control Flow Diagram

```
runtime.on("done") {
  evolution.attachReviewScores(workspace)          ◄── existing Phase 5
  for r in workspace.results: evolution.maybeEvolve(r.agentRole)

  if (metaOrchestrator && executionStore) {       ◄── Phase 7 guard
    recentExecutions = executionStore.listAll()
    blueprints       = blueprintStore.listAll()
    graphs           = workspaceToGraphs(workspace)
    signals          = extractDiscoverySignals(workspace)

    cycleResult = await metaOrchestrator.cycle({
      recentExecutions, blueprints, graphs, discoverySignals
    })
    console.log("meta-cycle summary")
  }
}

MetaOrchestrator.cycle() {
  // 1. baseline governance check
  baselineVerdict = governance.check(currentState)
  if (!baselineVerdict.allowed) blockedBy.push(reason)

  // 2. discover + propose
  for p in discovery.discover(signals, known): registry.propose(p)

  // 3. promote to active (gated by maxCapabilities)
  for c in registry.listAll():
    if c.status == "proposed": registry.transition(c, "experimental")
    if c.status == "experimental" AND projected_active < maxCapabilities:
      registry.transition(c, "active")
    if projected_active >= maxCapabilities:
      blockedBy.push("maxCapabilities")

  // 4. birth agents (gated by maxAgents)
  for c in activated:
    if birthBudget >= maxAgents:
      blockedBy.push("maxAgents")
      break
    birthResult = birth.birth(c)
    birthResult → saveBlueprint → BlueprintStore.save()  ◄── Phase 7: real disk write
    birthBudget++

  // 5. evaluate retirements
  for bp in activeBlueprints:
    retirement.evaluate(bp, recentExecs)
    if decision: retireBlueprint(bp.id) → BlueprintStore.retire()  ◄── Phase 7: real

  // 6. meta-agent decisions (create gated by maxAgents)
  for d in metaAgent.decide():
    if d.action == "create" AND birthBudget >= maxAgents:
      blockedBy.push("maxAgents")
      continue
    orgMemory.record(...)

  // 7. team-optimizer (materialized into BlueprintStore)         ◄── Phase 7
  teamHint = teamOptimizer.suggest(...)
  blueprintsModified = teamOptimizer.applyHint(teamHint)          ◄── real write
  orgMemory.record(...)

  // 8. final governance check
  finalVerdict = governance.check(finalState)
  return { ..., blockedBy, governance: finalVerdict }
}

DAGS.compose(userRequest) {
  // Phase 7 — sync dynamic capabilities from registry
  dynamicCaps = syncDynamicCapabilities()          ◄── API layer callback
  library.replaceDynamic(dynamicCaps)               ◄── replaces previous dynamic

  // Phase 1-6 logic (unchanged)
  capabilities = analyzer.analyze(userRequest)     ◄── now sees new caps
  blueprints   = generator.generate(capabilities)
  graph        = graphBuilder.build(...)
  await assigner.assign(graph)
  contexts     = assigner.buildAgentContexts(graph)
  return { graph, blueprints, contexts }
}
```

---

## Self-Evolution Closed-Loop Diagram

```
        ┌────────────────────────────────────────────────────────┐
        │                                                        │
        ▼                                                        │
   ┌─────────┐    ┌──────────────┐    ┌─────────────┐          │
   │ EXECUTE │───►│   REVIEW     │───►│  EVOLUTION  │          │
   │ DAGS +  │    │ ReviewIntell.│    │  Evolution  │          │
   │ Runtime │    │ (Phase 5)    │    │ (Phase 5)   │          │
   └─────────┘    └──────────────┘    └──────┬──────┘          │
        ▲                                    │                  │
        │                                    ▼                  │
        │                            ┌────────────────┐         │
        │                            │  META CYCLE    │         │
        │  Phase 7:                  │  (Phase 7)     │         │
        │  dynamic caps              └────────┬───────┘         │
        │  re-loaded                          │                 │
        │                                     ▼                 │
        │   ┌──────────────────────────────────────────────┐   │
        │   │  1. Discover (CapabilityDiscovery)            │   │
        │   │  2. Propose → Activate (CapabilityRegistry)   │   │
        │   │  3. Birth  (AgentBirth → BlueprintStore.save) │   │
        │   │  4. Retire (AgentRetire → BlueprintStore)     │   │
        │   │  5. Decide (MetaAgent, hard-blocked by gov.)  │   │
        │   │  6. Optimize (TeamOptimizer → metadata)      │   │
        │   │  7. Govern (governance.check → blockedBy[])   │   │
        │   │  8. Record (OrganizationMemory)               │   │
        │   └──────────────────────────────────────────────┘   │
        │                                     │                 │
        └─────────────────────────────────────┘                 │
                                                              │
   The "blueprints/" and "graphs/" on disk are the source of   │
   truth. Next DAGS.compose() reads them via BlueprintStore. ──┘
```

---

## Phase 6.5 vs Phase 7 — Truth Audit Comparison

| Module | Phase 6.5 Verdict | Phase 7 Verdict |
|---|---|---|
| `DAGS.compose` | TRUE CORE | TRUE CORE |
| `evolutionAwareFactory` | TRUE CORE | TRUE CORE |
| `ModelAssigner` / `ModelSelector` | TRUE CORE | TRUE CORE |
| `MemoryAugmentedAgent` | TRUE CORE | TRUE CORE |
| `AgentRuntime` | TRUE CORE | TRUE CORE |
| `EvolutionFacade.recordCompletion` | TRUE CORE | TRUE CORE |
| `MetaAgent` | SHADOW (decisions not applied) | SHADOW (only `create` gated; merge/split still log-only) |
| `TeamOptimizer` | SHADOW (hints only output) | **SHADOW → PARTIAL CORE** (hints → blueprint metadata via `applyHint`) |
| `SimulationEngine` | SHADOW (no consumers) | SHADOW (no consumers — Phase 8 candidate) |
| `GovernanceEngine` | SHADOW (allowed=false not blocking) | **SHADOW → PARTIAL CORE** (hard-blocks births + promotions + create decisions) |
| `MetaOrchestrator` | SHADOW (only manual cycle) | **SHADOW → PARTIAL CORE** (auto-triggered on every `done` event) |
| `LearningAPI` | SHADOW | SHADOW |
| `AgentBirthEngine` | SHADOW (no saveBlueprint) | **SHADOW → CORE** (real BlueprintStore.save via callback) |
| `AgentRetirementEngine` | SHADOW (no retireBlueprint) | **SHADOW → CORE** (real BlueprintStore.retire via callback) |
| `CapabilityDiscoveryEngine` | SHADOW (registry not linked to runtime) | SHADOW → CORE (registry → DAGS via `syncDynamicCapabilities`) |
| `CapabilityRegistry` | SHADOW (no consumers) | **SHADOW → CORE** (drives DAGS.compose via `replaceDynamic`) |
| `OrganizationMemory` | SHADOW (audit only) | SHADOW (still audit-only by design) |

**Net change**: 5 modules moved from SHADOW to CORE / PARTIAL CORE. Remaining SHADOW: `MetaAgent` (partial), `SimulationEngine`, `LearningAPI`, `OrganizationMemory` (audit-only by intent).

---

## What Phase 7 Actually Changes

| Capability | Before (Phase 6.5) | After (Phase 7) |
|---|---|---|
| New capability discovered | Logged, not used | Drives DAGS.compose() |
| Agent born | Audit file only | Blueprint on disk, used by next compose |
| Agent retired | Logged only | blueprint.retiredAt set, excluded from compose |
| Team-optimizer hint | Logged | Marked on blueprint metadata |
| Governance limit exceeded | Logged | Hard-blocks next mutations |
| Meta cycle | Manual `POST /api/meta/cycle` | Auto on every workspace done |
