# ADR-015: ExecutionRecord Must Be Replayable

**Status**: Accepted
**Date**: 2026-06-22
**Phase**: 5 (Autonomy)

## Context

要让系统能"从失败中学习"，必须能完整回放一次任务的执行上下文：
- 用的是哪个 Blueprint
- 哪个 TeamGraph
- 选了哪个 (provider, model)
- 产出了哪些 artifacts
- Review 说了什么
- 用户后续反馈了什么

如果 ExecutionRecord 只存"分数 + 任务 ID"，无法回答"为什么失败"。

## Decision

`ExecutionRecord` 必须包含以下字段：

| 字段 | 用途 |
|---|---|
| `id` | 主键 |
| `taskId` / `workspaceId` | 关联到 Runtime |
| `blueprintId` / `graphId` | 关联到 DAGS |
| `modelAssignment` | 实际使用的 (provider, model) |
| `artifacts` | 产出的文件列表 |
| `review` | 结构化 Review |
| `userFeedback` | 用户反馈列表 |
| `startedAt` / `completedAt` / `durationMs` | 时序 |

`ExecutionStore.save()` 强制校验这些字段，缺一不可。

## Consequences

**正面**：
- FailurePatternAnalyzer / EvolutionPlanner 可消费
- 可审计、可调试

**负面**：
- 每个 task 都要写一份 JSON
- 字段多可能膨胀（缓解：字段精简，不存 LLM 原始输出）
