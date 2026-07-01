# Changelog — 2026-06-22 (Phase 5.6：Automatic Promotion)

## 完成内容

实现 `PromotionEngine.decide(candidate, currentBlueprintId, allExecutions)`：
- 默认 A/B 规则：`minSample=20, minScoreGain=10%, minAcceptanceGain=15%`
- 过滤 current vs candidate runs，按 `execution.blueprintId` 匹配
- 计算 `scoreGain = (newScore - oldScore) / oldScore`
- 计算 `acceptGain = (newAccept - oldAccept) / oldAccept`（含 0 → 1 的兜底）
- verdict：
  - **promote** — 两个 gain 都达标 → 写 history + set candidate status
  - **reject** — 任一不达标 → 写 history + set status
  - **skip** — 样本不足 → 不写 history

存储：`<rootDir>/promotion-history.json`

## 修改文件

无

## 新增文件

- `packages/autonomy/src/promotion-engine.ts` — `PromotionEngine`
- `packages/autonomy/src/types.ts` — `PromotionRecordSchema`
- `packages/autonomy/test/autonomy-unit.test.ts` — 5.6 单元测试（8 个含 status 副作用）

## 删除文件

无
