# Phase 8 — Architecture: Digital Twin & Safe Evolution

**Date**: 2026-06-22
**Phase**: 8 — Self-Evolving + Self-Simulating System

---

## Goal

Convert Maximilian from "self-evolving" (Phase 7) into "self-evolving + self-simulating" (Phase 8). Every birth / retirement / promotion / merge / split decision now flows through:

1. **Digital Twin** — read-only snapshot of organization state
2. **Proposal Pipeline** — simulate → score → approve
3. **Safe Rollout** — shadow / canary / full mode
4. **Replay Engine** — historical validation

No decision bypasses the pipeline.

---

## Architecture Diagram

```
                USER REQUEST
                     │
                     ▼
              @max/api (Hono)
                     │
                     ▼
              DAGS.compose()
                     │
                     ▼
          AgentRuntime ──► done event ──► runtime.on()
                                          │
                                          ▼
                                ┌─────────────────────────────────────┐
                                │  MetaOrchestrator.cycle()          │
                                │  (Phase 8 wired)                   │
                                └─────────────┬───────────────────────┘
                                              │
                ┌──────────────────┬──────────┼──────────┬───────────────────┐
                ▼                  ▼          ▼          ▼                   ▼
         DiscoveryEngine    CapabilityReg  BirthEngine  RetirementEngine  TeamOptimizer
                │                  │          │          │                   │
                ▼                  ▼          ▼          ▼                   ▼
         CapabilityProposal  CapabilityRecord  AgentBirthResult  RetirementDecision  TeamOptimizerHint
                │                  │          │          │                   │
                ▼                  ▼          ▼          ▼                   ▼
              ──── all become ──── Proposals (unified mutation request) ──────
                                              │
                                              ▼
                          ┌──────────────────────────────────────┐
                          │     ProposalPipeline (Phase 8)       │
                          └─────────────┬────────────────────────┘
                                        │
       ┌────────────────────────────────┼─────────────────────────────────┐
       │                                │                                 │
       ▼                                ▼                                 ▼
   STEP 1                          STEP 2                             STEP 3
   simulate                        score                              approve
   DigitalTwin.capture()           scoreProposal()                    utility > 0?
       + DigitalTwin.apply()            │                                 │
       + SimulationEngine.              ▼                                 ▼
         simulateDelta()           DecisionScore                   ┌──────┴──────┐
       │                          (qualityGain -                  │             │
       ▼                            penalties)               approved       rejected
   SimulationDelta                                           │             │
   (cost/latency/                                            ▼             ▼
    quality/risk)                                  SafeRollout.apply()  (log only)
       │                                                │
       │           ┌────────────────────────────────────┼────────────────┐
       │           │                                    │                │
       │           ▼                                    ▼                ▼
       │       shadow                              canary              full
       │       (record only)                       (hash < 0.1)        (always)
       │           │                                    │                │
       │           └──────────────┬─────────────────────┘                │
       │                          ▼                                      │
       │                manualSaveBlueprint?                             │
       │                manualRetireBlueprint?                            │
       │                          │                                      │
       │                          ▼                                      │
       │                  BlueprintStore.save / retire                   │
       │                          │                                      │
       │                          ▼                                      │
       │              blueprints/<id>.json (real disk write)              │
       │                                                                   │
       └───────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
                                    OrganizationMemory.record()
                                              │
                                              ▼
                                    /api/meta/events JSON
```

---

## Data Flow Diagram — Birth example

```
1. CapabilityDiscoveryEngine.discover()
   → CapabilityProposal (mobile_app_development)

2. CapabilityRegistry.propose() → status="proposed"
   CapabilityRegistry.transition() → status="experimental"
   CapabilityRegistry.transition() → status="active"  (PROPOSAL-PIPELINE auto-approved)
   activated.push(c)

3. For each activated:
   birthProposal = createProposal({
     action: "birth",
     subject: c.id,
     rationale: "...",
     source: "meta_agent"
   })

4. ProposalPipeline.run(birthProposal):
   ┌────────────────────────────────────────────────────────┐
   │ snapshot = DigitalTwin.capture()                       │
   │ twinAfter = DigitalTwin.apply(snapshot, {              │
   │   kind: "birth", subject: c.id                         │
   │ })                                                     │
   │ before = snapshotToSimulationInput(snapshot, "before") │
   │ after  = snapshotToSimulationInput(twinAfter, "after") │
   │ simulation = simulationEngine.simulateDelta(before, after)
   │ score = scoreProposal(birthProposal, simulation)       │
   │ return { proposal, simulation, score, approved }       │
   └────────────────────────────────────────────────────────┘

5. If approved:
   SafeRollout.apply({
     proposal: birthProposal,
     applyMutation: () => manualSaveBlueprint(blueprint),
     canaryKey: c.id
   })
     - shadow: skip
     - canary: hash(c.id) < 0.1 ? apply : skip
     - full: apply

6. OrganizationMemory.record("agent_born", blueprintId, {
     proposalId, action, rolloutMode, applied, utility
   })
```

---

## Control Flow Diagram — Phase 8 mutations

```
Every mutation that changes team structure MUST go through:

   Decision Source ──► Proposal ──► Pipeline ──► Rollout ──► Live state
                        │              │            │             │
                        │              │            │             │
                        └─ simulation  │            │             │
                                       │            │             │
                                       └─ score     │             │
                                                    │             │
                                                    └─ apply ─────┘
                                                      (or skip)
```

**No mutation can skip a step.**

---

## Safe Rollout Decision Tree

```
rollout.mode = ?
├── shadow
│   └── apply?  NEVER.  (record only)
├── canary
│   └── hash(canaryKey) < 0.1?
│       ├── yes → apply
│       └── no  → skip
└── full
    └── apply?  ALWAYS.
```

---

## Decision Scoring

```
utility = quality_gain − latency_penalty − cost_penalty − risk_penalty

qualityGain    = max(0, sim.qualityDelta)        * 1.0
latencyPenalty = max(0, sim.latencyDeltaMs)      * 0.001
costPenalty    = max(0, sim.costDelta)           * 1.0
riskPenalty    = max(0, sim.riskDelta)           * 10.0

approved = utility > 0
```

---

## Replay Flow

```
Historical execution data
        │
        ▼
ReplayEngine.replay({ proposal, scoreDelta })
        │
        ├── filter executions where agentRole matches proposal.subject
        ├── compute baselineQuality (avg review.score)
        ├── simulatedQuality = baselineQuality + scoreDelta
        │
        ▼
ReplayOutcome {
  proposalId,
  baselineQuality,
  simulatedQuality,
  qualityDelta,
  affectedExecutions,
  at
}
```

Used for:
1. Pre-rollout validation
2. Post-rollout audit
3. A/B comparison of competing proposals