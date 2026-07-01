# Phase 8 — 任务 6: ReplayEngine (历史回放)

**Date**: 2026-06-22
**Status**: ✅ Completed

## 修改文件

| 文件 | 修改 |
|------|------|
| `packages/meta-system/src/replay-engine.ts` | **新文件** — `ReplayEngine` 类 + `ReplayDeps` + `ReplayInput` |
| `packages/meta-system/src/types.ts` | `ReplayOutcomeSchema`(baselineQuality/simulatedQuality/qualityDelta/affectedExecutions) |
| `packages/meta-system/src/index.ts` | 导出 `ReplayEngine`, `ReplayDeps`, `ReplayInput` |

## ReplayEngine.replay()

回答问题:"如果这个 Proposal 之前就被采用,历史任务结果会如何变化?"

```typescript
const engine = new ReplayEngine({
  getExecutions: async () => executionStore.listAll()
});

const outcome = await engine.replay({
  proposal,
  scoreDelta: 1.0  // 预测的质量提升
});
// {
//   proposalId: "prop-xxx",
//   baselineQuality: 7.5,    // 历史平均分
//   simulatedQuality: 8.5,   // 假设 Proposal 已生效
//   qualityDelta: 1.0,
//   affectedExecutions: 23,  // 受影响的执行数
//   at: "2026-06-22T..."
// }
```

## 测试

2 个 ReplayEngine 测试:
- 影响 executions 的 baseline quality
- 无匹配 executions 时返回 0

总测试: 100 → 102 (Phase 8 单元)
## 用途

1. **事前验证**: 在 canary rollout 前,用历史数据回放验证预测的 utility 是否合理
2. **事后审计**: 决策落地后,用新的 execution 数据回放验证 utility 与实际一致
3. **A/B 框架**: 给同一组历史数据应用不同 proposal,对比 outcome