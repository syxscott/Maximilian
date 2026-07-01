# Changelog — 2026-06-22 (Phase 5.1：Execution History)

## 完成内容

实现 ExecutionStore：每次任务执行后落盘一条 ExecutionRecord。

记录字段：
- id / taskId / workspaceId / agentRole
- blueprintId / blueprintVersion / graphId
- modelAssignment（provider, model）
- artifacts（文件路径列表）
- review（可选，Phase 5.2 填充）
- userFeedback（用户评分）
- startedAt / completedAt / durationMs
- status（pending/running/completed/failed）+ error

API 端点：
- `GET  /api/executions` — 列出所有记录
- `GET  /api/executions/:id` — 按 id 查
- `GET  /api/executions/workspace/:workspaceId` — 按 workspace 查
- `GET  /api/executions/role/:role` — 按角色查
- `POST /api/executions/:id/feedback` — 追加用户反馈

存储：`<rootDir>/executions/<id>.json`

## 修改文件

- `apps/api/package.json` — 添加 `@max/autonomy` 依赖
- `apps/api/src/index.ts` — 注册 executions 路由（仅 DAGS_MODE）

## 新增文件

- `packages/autonomy/src/types.ts` — `ExecutionRecordSchema` / `ExecutionRecord` 类型
- `packages/autonomy/src/execution-store.ts` — `ExecutionStore` 类
- `packages/autonomy/src/index.ts` — 导出 `ExecutionStore`
- `apps/api/src/routes/executions.ts` — HTTP 路由
- `packages/autonomy/test/autonomy-unit.test.ts` — 5.1 单元测试（4 个）

## 删除文件

无
