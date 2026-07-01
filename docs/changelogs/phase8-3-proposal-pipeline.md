# Phase 8 — 任务 3: Proposal Pipeline

**Date**: 2026-06-22
**Status**: ✅ Completed

## 修改文件

| 文件 | 修改 |
|------|------|
| `packages/meta-system/src/proposal-pipeline.ts` | **新文件** — `createProposal` + `ProposalPipeline.run()` + `scoreProposal` + `fromAgentChange` + `fromTeamHint` |
| `packages/meta-system/src/types.ts` | `ProposalSourceEnum`(meta_agent/team_optimizer/evolution_planner/manual) + `ProposalSchema` |
| `packages/meta-system/src/index.ts` | 导出 `ProposalPipeline`, `createProposal`, `scoreProposal`, `fromAgentChange`, `fromTeamHint`, `PipelineDeps`, `PipelineResult` |

## Pipeline 流程

```
MetaAgent.decide()  ─┐
                     ├──► Proposal ──► pipeline.run() ──► (approved | rejected)
TeamOptimizer.suggest() ─┘                                          │
                                                                   ▼
                                                          SafeRollout.apply()
```

每次 `pipeline.run(proposal)`:
1. **simulate** — `DigitalTwin.capture()` + `DigitalTwin.apply()` + `SimulationEngine.simulateDelta()`
2. **score** — `scoreProposal()` 计算 utility
3. **approve** — `approved = utility > 0`

## Helper: fromAgentChange / fromTeamHint

将 Phase 6/7 的旧决策格式转成 Phase 8 的 Proposal:

```typescript
fromAgentChange({ action: "create" })    // → Proposal(action="birth")
fromAgentChange({ action: "delete" })    // → Proposal(action="retire")
fromAgentChange({ action: "merge" })     // → Proposal(action="merge")
fromAgentChange({ action: "split" })     // → Proposal(action="split")

fromTeamHint(hint)                       // → Proposal[] (remove_redundant→retire, grow_team→rebalance_team, ...)
```

## 测试

5 个 Pipeline 测试 + 2 个 helper 测试 = 7 个新测试。

总测试: 84 → 91 (Phase 8 单元)
## 关键约束

- 所有 Proposal 必须在 `pipeline.run()` 之后才被允许 apply
- 没有"绕过 pipeline 直接 mutation"的代码路径(见 phase8-truth-audit.md)