# Phase 8 — 任务 1: 接管 SimulationEngine

**Date**: 2026-06-22
**Status**: ✅ Completed

## 修改文件

| 文件 | 修改 |
|------|------|
| `packages/meta-system/src/types.ts` | 新增 `SimulationDeltaSchema` (costDelta/latencyDeltaMs/qualityDelta/riskDelta) + `ProposalSchema` + `ProposalActionSchema` (birth/retire/promote/demote/merge/split/rebalance_team) + `ProposalStatusSchema` + `OrganizationSnapshotSchema` + `RolloutModeSchema` + `DecisionScoreSchema` + `ReplayOutcomeSchema` |
| `packages/meta-system/src/simulation.ts` | `SimulationEngine` 新增 `simulateDelta(before, after): Promise<SimulationDelta>` |
| `packages/meta-system/src/index.ts` | 导出 `SimulationDelta` 等新类型 |

## 关键变更

**SimulationEngine.simulateDelta** — 在两次 `simulate()` 之上计算差值:

```typescript
async simulateDelta(before: SimulationInput, after: SimulationInput): Promise<SimulationDelta> {
  const beforeResult = await this.simulate(before);
  const afterResult = await this.simulate(after);
  return {
    costDelta: afterResult.totalEstimatedCost - beforeResult.totalEstimatedCost,
    latencyDeltaMs: afterResult.totalEstimatedLatencyMs - beforeResult.totalEstimatedLatencyMs,
    qualityDelta: afterResult.estimatedAvgQuality - beforeResult.estimatedAvgQuality,
    riskDelta: afterResult.riskScore - beforeResult.riskScore,
    before: beforeResult, after: afterResult,
    simulatedAt: new Date().toISOString(),
  };
}
```

**返回字段**:
- `costDelta` — 总成本变化
- `latencyDeltaMs` — 总延迟变化
- `qualityDelta` — 平均质量变化
- `riskDelta` — 风险分数变化
- `before` / `after` — 完整 SimulationResult 用于调试

## 测试

新增 4 个 `SimulationEngine.simulateDelta` 测试 (`test/phase8-unit.test.ts`):
- 相同 org → delta 全为 0
- 添加节点 → costDelta > 0, latencyDeltaMs > 0
- 退役高质量角色 → qualityDelta < 0
- delta.before / delta.after / simulatedAt 字段正确

总测试: 73 → 77 (Phase 8 单元)
## 接入路径

`SimulationDelta` 被 `ProposalPipeline.run()` 在每次 mutation 前调用,得到 delta 后才允许 mutation 落地(配合 SafeRollout 灰度)。