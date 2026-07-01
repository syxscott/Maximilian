# Phase 8 — Truth Audit Report

**Date**: 2026-06-22
**Status**: ✅ Completed

---

## TL;DR

Every structural mutation in MetaOrchestrator.cycle() — **birth, retirement, promotion, merge, split, team rebalance** — flows through the Phase 8 proposal pipeline. No decision bypasses simulate → score → rollout.

The only direct mutations remaining are **advisory / metadata-only** operations (registry.propose, registry.transition to "experimental") that do not change team structure.

---

## Audit method

```bash
grep -nE "this\.deps\.(birth|retirement|registry|teamOptimizer|metaAgent)" packages/meta-system/src/orchestrator.ts
```

Walk through each line, classify by mutation kind, and verify whether Phase 8 path is taken.

---

## Mutation sites in MetaOrchestrator

| Line | Operation | File | Phase 8 path |
|------|-----------|------|--------------|
| 138 | `registry.propose()` | orchestrator.ts | Direct — discovery is advisory only |
| 161 | `registry.transition(..., "experimental")` | orchestrator.ts | Direct — metadata only, no team structure change |
| 190 | `registry.transition(..., "active")` | orchestrator.ts | **PIPELINE** (via `runPromotionProposal`) — auto-approved since governance-gated |
| 199 | `registry.transition(..., "active")` | orchestrator.ts | Direct — Phase 7 fallback, only when `pipeline` not wired |
| 232 | `birth.birth(c)` | orchestrator.ts | **PIPELINE** + `manualSaveBlueprint` (Phase 8 only) |
| 246 | `birth.birth(c)` | orchestrator.ts | Direct — Phase 7 fallback, only when `pipeline` not wired |
| 261 | `retirement.evaluateAll(...)` | orchestrator.ts | **PIPELINE** + `manualRetireBlueprint` (Phase 8 only) |
| 314 | `metaAgent.decide(...)` | orchestrator.ts | Read-only — returns plan, no mutation |
| 365 | `teamOptimizer.suggest(...)` | orchestrator.ts | Read-only — returns hint |
| 388 | `teamOptimizer.applyHint(...)` | orchestrator.ts | **PIPELINE** (each suggestion → Proposal via `fromTeamHint`) |

---

## Hidden path detection

### Issue 1: Engine callbacks bypass pipeline

`AgentBirthEngine.birth()` checks `if (this.deps.saveBlueprint) { await this.deps.saveBlueprint(...) }`. If the API constructs the engine WITH `saveBlueprint: blueprintStore.save`, then `birth.birth(c)` writes to disk regardless of pipeline state.

**Fix applied**:
- `apps/api/src/index.ts` lines 234-247: when `DIGITAL_TWIN_ENABLED=true`, the engine constructors **omit** `saveBlueprint`, `retireBlueprint`, and `applyToBlueprintStore` callbacks.
- `MetaOrchestratorDeps` adds `manualSaveBlueprint` and `manualRetireBlueprint` optional fields.
- Orchestrator's Phase 8 paths call these manual hooks **only after** `trace.pipelineApproved && trace.rollout?.applied`.

**Test coverage**: `phase8-unit.test.ts > 8.7 > manualSaveBlueprint is called only after pipeline+rollout approval` — verifies saved count equals applied count.

### Issue 2: AgentRetirementEngine.retireBlueprint callback

Same pattern as Issue 1 but for retirements. Same fix applied — engine constructor omits `retireBlueprint` callback when Phase 8 enabled.

### Issue 3: TeamOptimizer.applyToBlueprintStore

Same pattern. Fix: omit `applyToBlueprintStore` callback when Phase 8 enabled. In Phase 8 mode, team-optimizer suggestions are routed through `fromTeamHint()` → Proposal → pipeline → rollout.

---

## Direct mutations (NOT routed through pipeline)

| Operation | Why allowed |
|-----------|-------------|
| `registry.propose(...)` | Pure advisory: creates a CapabilityRecord in "proposed" status. No team structure impact. Cannot be auto-applied (must be promoted through registry.transition). |
| `registry.transition(..., "experimental")` | Metadata change within capability lifecycle. No team structure impact (no blueprints added). |
| `OrganizationMemory.record(...)` | Audit log. Not a structural mutation. |
| `GovernanceEngine.check(...)` | Read-only. |
| `CapabilityRegistry.list*()` | Read-only. |

These are either advisory, read-only, or audit-only — none change the blueprint store or team graph.

---

## Pipeline entry points (Phase 8 path)

Every pipeline call originates from `MetaOrchestrator.runProposal(proposal)` or `MetaOrchestrator.runPromotionProposal(proposal)`:

| Mutation | Entry point | Pipeline |
|----------|-------------|----------|
| Birth | `MetaOrchestrator.cycle()` line 220 (`createProposal("birth")`) | ✓ |
| Retirement | `MetaOrchestrator.cycle()` line 256 (`createProposal("retire")`) | ✓ |
| Promotion to active | `MetaOrchestrator.cycle()` line 174 (`createProposal("promote")`) | ✓ (auto-approved, governance-gated) |
| MetaAgent create | `MetaOrchestrator.cycle()` line ~309 (`fromAgentChange`) | ✓ |
| MetaAgent delete | same | ✓ |
| MetaAgent merge | same | ✓ |
| MetaAgent split | same | ✓ |
| TeamOptimizer remove_redundant | `MetaOrchestrator.cycle()` line ~359 (`fromTeamHint`) | ✓ |
| TeamOptimizer shrink_team | same | ✓ |
| TeamOptimizer grow_team | same | ✓ |
| TeamOptimizer add_review_node | same | ✓ |
| TeamOptimizer parallelize | same | ✓ |

**12 of 12** structural mutation entry points go through the pipeline.

---

## Simulation coverage

`SimulationEngine.simulateDelta()` is called for **every** proposal that enters `ProposalPipeline.run()`. The output `SimulationDelta` (costDelta/latencyDeltaMs/qualityDelta/riskDelta) is attached to the trace returned by `runProposal()` and exposed in `MetaCycleResult.proposalsPhase8[]`.

**Test coverage**: `phase8-unit.test.ts > 8.7 > uses SimulationDelta for every birth/retirement/promotion decision` — verifies that every trace has all 4 delta fields defined.

---

## Rollout coverage

Every approved proposal goes through `SafeRollout.apply()` which respects the current mode:
- `shadow`: never applies (default, ROLLOUT_CONFIG.defaultMode)
- `canary`: applies only when `hash(canaryKey) < 0.1`
- `full`: always applies

**Test coverage**: 5 SafeRollout unit tests + 1 e2e test for canary variance.

---

## Verdict

✅ All Phase 8 goals met:

1. **SimulationDelta** computed for every structural mutation
2. **Digital Twin** snapshots all state; mutations only on twin
3. **Proposal Pipeline** is the single chokepoint (no other write paths)
4. **Safe Rollout** modes (shadow/canary/full) all wired and tested
5. **Decision Scoring** uses utility formula `quality_gain − latency − cost − risk`
6. **ReplayEngine** validates historical what-if scenarios
7. **No hidden paths** — engine callbacks disabled when Phase 8 wired

The system can:
> 提出变更 → 模拟结果 → 评估风险 → 灰度发布 → 收集反馈 → 再决定是否正式采用

Default rollout mode is **shadow**, so out-of-the-box behavior is simulation-only. Switch to `SAFE_ROLLOUT_MODE=canary` or `=full` to actually apply mutations.