# ADR-011: Capability-First Modeling

**Status**: Accepted
**Date**: 2026-06-22
**Phase**: 4 (DAGS)

## Context

Maximilian 当前以"角色"（frontend / backend / review）作为 Agent 的第一分类单元。这种模型：

- 与具体任务领域强耦合，无法表达跨领域能力（如"数据可视化"既可能是前端任务也可能是后端任务）
- 不支持运行时新增角色（必须修改 `@max/agents` 包）
- 无法处理一个角色同时覆盖多种能力的场景

## Decision

引入 **Capability** 作为 Agent 的第一公民。角色（role）成为运行时实例的标签，能力（capability）成为能力库的成员。

- `CapabilityLibrary` 内嵌初始能力集合
- `AgentBlueprint` 声明它覆盖的 `capabilities: string[]`
- `TeamGraph` 由能力组合而成，运行时映射为 Agent 实例
- 未来添加新能力 = 往库中追加 JSON，无需改核心代码

## Consequences

**正面**：
- 能力可被复用、可被搜索
- 同一能力可被多个角色实现（多模型协作）
- 用户可在请求中显式指定能力

**负面**：
- 概念层级加深一层（Capability → Blueprint → Agent）
- 现有 `AgentRole` 类型仍需保留（向后兼容）

## Alternatives Considered

1. **保留角色，扩展枚举** → 不可扩展，每次新增都要改 type
2. **完全用 string role** → 失去类型安全
3. **混合方案（采纳）** → 能力优先，角色作为运行时标签
