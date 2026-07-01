# ADR-013: Team Graph as DAG

**Status**: Accepted
**Date**: 2026-06-22

## Context

Agent 之间的依赖关系可能：
- 串行（Frontend 依赖 Backend 的 API 契约）
- 并行（多个独立模块可同时开发）
- 评审（Review Agent 依赖所有上游产物）

需要一种数据结构表达这些关系，并支持：
- 拓扑排序（执行顺序）
- 循环检测（防止死锁）
- 并行识别（同一层可并发）

## Decision

TeamGraph 强制为有向无环图（DAG）。

- `nodes[].dependsOn: string[]` 表达局部依赖
- `edges[]` 表达显式协作关系
- 构建时用 Kahn 算法拓扑排序
- 检测到循环时返回明确错误，不进入执行

并行层（`layers`）由算法自动计算：每完成一层入度归零的节点，下一层开始。

## Consequences

**正面**：
- 死锁可被静态检测
- 并行机会显式可见
- 算法可形式化验证

**负面**：
- 不支持运行时动态修改依赖（一旦构建完成，结构固定）
- 反馈环（如"测试不通过则回退到开发"）需要由 Agent 内部处理，而非 Graph 层面

## Alternatives

- **Petrinet** → 表达力过强，实现复杂
- **状态机** → 偏执行时序，不偏协作
- **DAG（采纳）** → 简洁、可分析、runtime 友好
