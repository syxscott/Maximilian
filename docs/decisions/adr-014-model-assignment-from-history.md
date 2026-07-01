# ADR-014: Model Assignment from Historical Performance

**Status**: Accepted
**Date**: 2026-06-22

## Context

Phase 3 的 Evolution Engine 已经能够为给定角色选择最优 (provider, model)。DAGS 必须复用这一能力，而非硬编码"Frontend → Claude"之类的固定映射。

## Decision

模型分配由 `EvolutionFacade.selectForRole(role)` 决策，调用方传入的角色字符串来自 Blueprint。系统**禁止**在 Blueprint 中硬编码 `model`。

Blueprint 中保留 `preferredModels: ModelHint[]` 字段，但其作用仅为：
1. 当历史数据不足时作为 hint
2. 文档化"该能力理论上适合什么模型"

最终模型由 `EvolutionEngine` 在执行前决定。

## Consequences

**正面**：
- 真正实现"多模型协作"
- 模型选择随时间自动优化
- 与 Evolution Engine 单一来源对齐

**负面**：
- 同一能力在不同团队中可能使用不同模型（这正是目标，不是负面）
- 第一次运行任何能力时只能 fallback 到 defaultModel
