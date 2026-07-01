# Changelog — 2026-06-22 (Phase 5.8：DAGS_MODE 主流程接入)

## 完成内容

实现 `DAGS_MODE=true` 让 `/api/chat` 走 DAGS 流水线：

1. 跳过 `Commander.plan()`，直接 `DAGS.compose(userRequest)`
2. 把 `ComposedTeam.graph.nodes` 转换为 `Plan.tasks`
3. 用 `DAGS.buildAgentFactory(composed)` 构造动态工厂
4. 启动独立的 `AgentRuntime` 执行 plan
5. 执行完成后调用 `AutonomyOrchestrator.observe(workspace)` 触发闭环

新增 `AutonomyOrchestrator.observe(workspace)` 编排：
1. 写 execution record
2. 写 structured review
3. 触发 FailurePatternAnalyzer.analyze + leaderboardInsight
4. 触发 EvolutionPlanner.plan（每个 role 一次）
5. 触发 CandidateGenerator.generate（每个 plan 一次）
6. 触发 PromotionEngine.decide（每个 candidate 一次）

DAGS_MODE=false 时维持原 Commander 流程不变（零回归）。

## 修改文件

- `apps/api/src/index.ts` — 初始化 DAGS + AutonomyOrchestrator（仅 DAGS_MODE），wire learning / executions 路由
- `apps/api/src/routes/chat.ts` — 在 chat handler 开头分支 DAGS_MODE
- `apps/api/package.json` — 添加 `@max/autonomy` 和 `@max/dags` 依赖

## 新增文件

- `apps/api/src/dags-flow.ts` — DAGS_MODE 流程（buildDagsWorkspace + runDagsFlow）
- `packages/autonomy/src/autonomy-orchestrator.ts` — `AutonomyOrchestrator`
- `packages/autonomy/test/autonomy-unit.test.ts` — 5.8 单元测试（5 个 observe 循环）
- `apps/api/test/autonomy-integration.test.ts` — 4 个集成测试
- `apps/api/test/e2e-dags-mode.test.ts` — 3 个 E2E 测试

## 删除文件

无
