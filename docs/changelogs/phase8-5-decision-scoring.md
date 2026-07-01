# Phase 8 — 任务 5: Decision Scoring (Utility Formula)

**Date**: 2026-06-22
**Status**: ✅ Completed

## 修改文件

| 文件 | 修改 |
|------|------|
| `packages/meta-system/src/proposal-pipeline.ts` | 新增 `scoreProposal(proposal, sim): DecisionScore` |
| `packages/meta-system/src/types.ts` | `DecisionScoreSchema`(qualityGain/latencyPenalty/costPenalty/riskPenalty/utility/approved/reason) + `DECISION_SCORING_CONFIG` |

## Utility 公式

```
utility = quality_gain − latency_penalty − cost_penalty − risk_penalty

qualityGain    = max(0, sim.qualityDelta) * qualityWeight  // 1.0
latencyPenalty = max(0, sim.latencyDeltaMs) * latencyWeight // 0.001
costPenalty    = max(0, sim.costDelta) * costWeight        // 1.0
riskPenalty    = max(0, sim.riskDelta) * riskWeight        // 10.0

approved = utility > 0
```

只有 `utility > 0` 才进入 rollout。0 或负数被拒绝。

## 测试

4 个 DecisionScore 测试:
- utility = qualityGain − penalties 公式正确
- 正 utility → approved
- 0 utility → 拒绝 (因为 utility > 0 不成立)
- risk delta 显著惩罚

总测试: 96 → 100 (Phase 8 单元)
## 权重选择

| 权重 | 值 | 解释 |
|------|------|------|
| `qualityWeight` | 1.0 | 质量是首要指标 |
| `costWeight` | 1.0 | 成本直接影响 1:1 |
| `latencyWeight` | 0.001 | 延迟单位是 ms,需缩放 |
| `riskWeight` | 10.0 | 风险是最严格的红线 |

任何 +0.1 的 riskDelta 都会被 1.0 的 qualityDelta 抵消。