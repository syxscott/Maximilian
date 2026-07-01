# Phase 5 — Stage 7: Learning Dashboard API

**日期**: 2026-06-22
**状态**: ✅ 完成

## 实现内容

- `LearningAPI` 只读查询层
  - `status()` / `agents()` / `evolutionHistory()` / `failurePatterns()`
  - `getFailureAnalyzer()` 暴露给上层触发 mining
- HTTP 端点（仅 DAGS_MODE 注册）：
  - `GET /api/learning/status`
  - `GET /api/learning/agents`
  - `GET /api/learning/evolution-history`
  - `GET /api/learning/failure-patterns`
  - `POST /api/learning/mine-failure-patterns`

## 测试结果

- vitest: 6 个测试，全部通过
- type-check: 0 错误

## 代码统计

| 文件 | 行数 |
|---|---|
| `packages/autonomy/src/learning-api.ts` | 117 |
| `apps/api/src/routes/learning.ts` | 60 |
