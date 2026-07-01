# Changelog — 2026-06-22 (Phase 5.3：Failure Pattern Mining)

## 完成内容

实现 `FailurePatternAnalyzer`：
- 扫描最近 N=50 条 execution 的 `review.failurePatterns`
- 按 pattern 聚合：frequency / agentRoles / providers / models / avgScore / examples
- 按 frequency 降序排序
- 写入 `<rootDir>/insights/failure-patterns.json`

实现 `leaderboardInsight`：
- 按 role / model 分组计算 avgScore
- 排序取最差前 5
- 写入 `<rootDir>/insights/leaderboard-insights.json`

## 修改文件

无

## 新增文件

- `packages/autonomy/src/insights-store.ts` — `InsightsStore` + `FailurePatternAnalyzer`
- `packages/autonomy/src/types.ts` — `FailureInsightSchema` / `LeaderboardInsightSchema`
- `packages/autonomy/test/autonomy-unit.test.ts` — 5.3 单元测试（3 个）

## 删除文件

无
