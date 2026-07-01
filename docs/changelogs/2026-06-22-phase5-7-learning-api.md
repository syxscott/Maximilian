# Changelog — 2026-06-22 (Phase 5.7：Learning Dashboard API)

## 完成内容

实现 `LearningAPI` 只读查询层：

| 方法 | 返回 |
|---|---|
| `status()` | totalExecutions / totalCandidates / totalPromotions / activeInsights / per-role avgScore & acceptance |
| `agents()` | per-role summary，含 lastRun |
| `evolutionHistory()` | plans + promotions + candidates |
| `failurePatterns()` | 当前 `insights/failure-patterns.json` 内容 |
| `getFailureAnalyzer()` | 暴露 FailurePatternAnalyzer 用于 on-demand mining |

HTTP 端点（仅 DAGS_MODE=true 注册）：
- `GET  /api/learning/status`
- `GET  /api/learning/agents`
- `GET  /api/learning/evolution-history`
- `GET  /api/learning/failure-patterns`
- `POST /api/learning/mine-failure-patterns` — 触发重新挖掘

## 修改文件

- `apps/api/src/index.ts` — 注册 learning 路由
- `apps/api/src/routes/learning.ts` — 新建路由文件

## 新增文件

- `packages/autonomy/src/learning-api.ts` — `LearningAPI`
- `apps/api/src/routes/learning.ts` — HTTP 路由
- `packages/autonomy/test/autonomy-unit.test.ts` — 5.7 单元测试（6 个含 status / agents / patterns / history）

## 删除文件

无
