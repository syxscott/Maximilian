# `evolution` vs `meta-system` — Package Boundary

Two packages in the monorepo carry "evolution" in their purpose and can
look redundant at first glance. This document pins down the boundary so
contributors don't accidentally double-write logic, and so readers
navigating the codebase know which package owns which concern.

## TL;DR

| Package | Layer | Job | Audience |
|---|---|---|---|
| `@max/evolution` | **Data / primitives** | Per-role statistics, profiles, leaderboards, A/B test engine | Runtime hot path — fast in-process reads/writes |
| `@max/meta-system` | **Decision / governance** | Capability lifecycle, proposal pipeline, simulation, rollout, replay, truth audit | Periodic / async cycle — does the org change itself |

`evolution` is the **memory**; `meta-system` is the **decision-maker
that reads that memory** (along with execution history + governance rules).

## What lives where

### `@max/evolution` (1,505 LoC)

| Module | Purpose |
|---|---|
| `MetricsStore` | Per-task metric counter (success / fail / latency / cost / quality) |
| `ProfileStore` | Long-term per-role profile (rolling average quality, latency, cost) |
| `Leaderboard` | Per-(role, provider, model) ranking — which combo works best |
| `ModelSelector` | Auto-pick best (provider, model) for a role given its profile |
| `AgentMemoryStore` | Per-role long-term memory with compression |
| `EvolutionEngine` | A/B test new prompt versions, promote winners |
| `EvolutionFacade` | High-level wiring the runtime / API can call directly |
| `evolutionAwareFactory` | Bridge that injects evolution data into agent construction |

**Used by**: `@max/core` runtime (per-task), `@max/providers` (model
selection), `@max/agents` (memory + skills prelude).

### `@max/meta-system` (3,629 LoC)

| Module | Purpose |
|---|---|
| `CapabilityRegistry` | Capability lifecycle (proposed → experimental → active → retired) |
| `CapabilityDiscoveryEngine` | Mine new capability proposals from user requests / failure patterns |
| `AgentBirthEngine` / `AgentRetirementEngine` | Birth / retire capabilities |
| `MetaAgent` | Decide create/delete/merge/split at the role level |
| `TeamOptimizer` | Suggest team-graph adjustments (rebalance teams) |
| `SimulationEngine` | Predict cost/latency/quality/risk delta of a proposed mutation |
| `GovernanceEngine` | Enforce limits, emit allow/deny verdicts |
| `MetaOrchestrator` | Tie all the above together per cycle |
| `ProposalPipeline` | Phase 8 — wrap every mutation as a Proposal that runs through simulation → scoring → rollout |
| `SafeRollout` | Phase 8.4 — shadow / canary / full apply modes |
| `DigitalTwin` | Phase 8.2 — clone current org snapshot, apply mutation, capture diff |
| `ReplayEngine` | Phase 8.6 — re-score historical executions under a hypothetical mutation |
| **`TruthAudit`** | Phase 8.7 — verify predictions vs reality after rollout |
| `PendingProposalStore` | Phase 11 — HITL pause for high-risk proposals |

**Used by**: `@max/api` workspace execution loop (periodic), `apps/api`
admin endpoints (manual triggers).

## Data flow

```
runtime task ─► metrics ─► evolution:MetricsStore ─► ProfileStore
                                                       │
                            MetaOrchestrator cycle ◄──┤
                                                       ▼
                                                 Leaderboard
                                                       │
                                                       ▼
                                             ModelSelector (per-task)

runtime task ─► ExecutionRecord ─► meta-system:Orchestrator (periodic)
                                          │
                                          ▼
                              DiscoveryEngine → CapabilityProposal
                                          │
                                          ▼
                              Pipeline (simulate → score → rollout)
                                          │
                                          ▼
                              AgentBirth / Retire / Merge / Split
                                          │
                                          ▼
                              TruthAudit (post-rollout verification)
```

## Why split?

1. **Hot path vs cold path.** `evolution` data is touched on every task
   (`MetricsStore.record`, `ProfileStore.getProfile`); it must stay in-process
   and fast. `meta-system` only runs on a slow cycle (every N executions, or
   on demand), so it can afford heavier LLM calls and disk reads.

2. **Single responsibility.** `evolution` answers *"which model is best
   for this role?"*; `meta-system` answers *"should we add or remove
   this capability?"*. Two different decision scopes, two different
   packages.

3. **Stable surface.** `evolution`'s API is consumed by many call sites;
   changes ripple widely. `meta-system`'s API is consumed only by the
   orchestrator; we can refactor it freely.

## Anti-patterns (what NOT to do)

| ❌ Don't | ✅ Do |
|---|---|
| Have `meta-system` import `evolution`'s `ProfileStore` directly | Pass profile data through `MetaOrchestratorDeps.benchmarkBridge` |
| Have `evolution` import `meta-system` types | Keep `evolution` standalone; it has no awareness of capabilities |
| Have both packages own a "leaderboard" | Only `evolution` owns Leaderboard; `meta-system` reads aggregated stats via `benchmarkBridge` |
| Have both packages compute quality deltas | `evolution` measures quality; `meta-system` *predicts* deltas via `SimulationEngine` and verifies with `TruthAudit` |

## When in doubt

- "Per-task, fast, hot path" → `@max/evolution`
- "Periodic, governance-heavy, may mutate org structure" → `@max/meta-system`
- "I want to A/B test two prompts" → `@max/evolution` (EvolutionEngine)
- "I want to spawn a new agent role" → `@max/meta-system` (AgentBirthEngine + Pipeline)