# ADR-018: DAGS_MODE as Opt-In Main Path

**Status**: Accepted
**Date**: 2026-06-22
**Phase**: 5

## Context

Phase 4 的 DAGS 是可选的包，没有被接入 `/api/chat`。要让"动态团队"成为常态，需要：
- 在 `/api/chat` 入口检测环境变量
- 如果 `DAGS_MODE=true`，改走 DAGS 路径
- 否则保持原 Phase 2 行为

## Decision

`DAGS_MODE` 默认为 `false`。开启时：

1. `POST /api/chat` 收到 user request
2. 调用 `DAGS.compose(userRequest)` 产出团队
3. `DAGS.buildAgentFactory(team)` 构造 factory
4. 用同一个 `AgentRuntime` 执行（不需修改 runtime）
5. 任务完成后调用 `AutonomyOrchestrator.observe()` 触发闭环

返回的 workspace 携带 `dagsGraphId`，便于前端展示。

## Consequences

**正面**：
- 真正实现"任意请求 → 动态团队"
- 旧的静态 Plan 路径仍可用

**负面**：
- DAGS 失败时需有 fallback（暂时 fallback 到原 Commander.plan）
- 资源消耗上升（缓解：Evolution 阶段会优化模型选择）
