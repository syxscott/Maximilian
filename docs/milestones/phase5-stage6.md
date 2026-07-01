# Phase 5 — Stage 6: Automatic Promotion

**日期**: 2026-06-22
**状态**: ✅ 完成

## 实现内容

- `PromotionRecord` 类型
- `PromotionEngine.decide(candidate, currentBlueprintId, executions)`：
  - minSample=20, minScoreGain=10%, minAcceptanceGain=15%
  - verdict: promote / reject / skip
  - 自动切换 candidate status
  - 追加到 `promotion-history.json`

## 测试结果

- vitest: 8 个测试（含 status 副作用），全部通过
- type-check: 0 错误

## 代码统计

| 文件 | 行数 |
|---|---|
| `packages/autonomy/src/promotion-engine.ts` | 172 |
