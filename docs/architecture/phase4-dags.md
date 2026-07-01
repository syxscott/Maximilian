# Phase 4 — Dynamic Agent Generation System (DAGS)

**Status**: Active
**Date**: 2026-06-22
**Author**: Maximilian

## 1. 背景

Maximilian 的 MVP（Phase 2）实现了一条固定链路：
`Commander → Backend Agent → Frontend Agent → Review Agent`。
Phase 3 引入了 Evolution Engine，让 Agent 可以被追踪、评分、自动选模型、版本化。

但**团队结构本身仍然是硬编码的**：
- Agent 角色在 `@max/agents/src/index.ts` 的 `defaultAgentFactory` 中写死；
- Commander 的启发式 fallback Plan 写死了 backend / frontend / review；
- 系统无法处理"开发数据库平台""科研论文分析"等需要不同团队的任务。

DAGS 的目标：**让团队结构本身成为可被系统动态生成、持久化、版本化、优化的对象。**

## 2. 设计目标

| 目标 | 描述 |
|---|---|
| **能力驱动** | 不再以"角色"为第一公民；以"能力"为第一公民 |
| **运行时生成** | Agent 在请求到达时由系统自动构造，而非来自静态注册表 |
| **持久化** | 所有生成的 Blueprint、Team Graph 落盘，可复用、可审计 |
| **可进化** | Blueprint 自身支持版本化（与 Evolution Engine 集成） |
| **DAG 执行** | 团队结构以有向无环图描述，支持并行与依赖分析 |
| **多模型协作** | 同一团队内不同 Agent 可使用不同 LLM，由 Evolution Engine 决策 |
| **可扩展** | 能力库可被外部添加，无需修改核心代码 |

## 3. 总体架构

```
                ┌──────────────────────────────────────────┐
                │           User Request                  │
                │   "开发一个科研论文分析系统"             │
                └─────────────────┬────────────────────────┘
                                  │
                                  v
                ┌──────────────────────────────────────────┐
                │      Stage 1: Capability Analyzer        │
                │  - 关键词匹配 / LLM 推断 / 默认 fallback   │
                │  Output: Capability[]                    │
                └─────────────────┬────────────────────────┘
                                  │
                                  v
                ┌──────────────────────────────────────────┐
                │   Stage 2: Blueprint Generator            │
                │  - 能力库 → AgentBlueprint[]              │
                │  - 持久化到 workspace/blueprints/         │
                └─────────────────┬────────────────────────┘
                                  │
                                  v
                ┌──────────────────────────────────────────┐
                │    Stage 3: Agent Factory (runtime)       │
                │  - 从 Blueprint 实例化 Agent              │
                │  - 注入模型、记忆、prompt                 │
                └─────────────────┬────────────────────────┘
                                  │
                                  v
                ┌──────────────────────────────────────────┐
                │    Stage 4: Team Graph Builder            │
                │  - 拓扑排序 / 循环检测 / 并行层识别        │
                │  - 产出可执行 Plan                        │
                └─────────────────┬────────────────────────┘
                                  │
                                  v
                ┌──────────────────────────────────────────┐
                │    Stage 5: Model Assignment              │
                │  - 调用 EvolutionEngine.selectForRole()   │
                │  - 注入到 Blueprint                        │
                └─────────────────┬────────────────────────┘
                                  │
                                  v
                ┌──────────────────────────────────────────┐
                │    Stage 6: Validation                    │
                │  - 3 个 case 端到端                       │
                │  - 对比动态 vs 静态团队输出               │
                └──────────────────────────────────────────┘
                                  │
                                  v
                         (回到 Runtime 执行)
```

## 4. 关键设计决策

| ADR | 决策 |
|---|---|
| [ADR-011](../decisions/adr-011-capability-first.md) | 能力优先于角色 |
| [ADR-012](../decisions/adr-012-blueprint-persistence.md) | Blueprint 必须持久化为 JSON |
| [ADR-013](../decisions/adr-013-team-graph-dag.md) | Team Graph 强制为 DAG |
| [ADR-014](../decisions/adr-014-model-assignment-from-history.md) | 模型分配由 Evolution 决策，禁止硬编码 |

## 5. 与现有模块的关系

| 现有模块 | 关系 |
|---|---|
| `Commander` | 上游：接收 Plan（静态）→ DAGS 接收 TeamGraph（动态） |
| `AgentRuntime` | 下游：被 DAGS 产出的 Plan 喂入，不需修改 |
| `@max/agents` 默认工厂 | **降级路径**：DAGS 不可用时仍可使用 |
| `EvolutionFacade` | 调用方：Model Assignment 阶段读 leaderboard |
| `FileWorkspaceStore` | 复用：blueprints 与 graphs 落盘 |
| `AgentMemoryStore` | 复用：动态 Agent 同样使用 AgentMemory |

## 6. 验证标准

- 给定 3 个差异极大的用户请求，生成 3 个不同的团队结构
- 所有 Blueprint 落盘、可被审计
- 模型分配由历史数据驱动，零硬编码
- 现有 4 个 smoke 测试 + 20 个 evolution 测试全部通过
- 12 个包 type-check 通过

## 7. 不在范围内

- UI 改造（明确禁止）
- 多租户
- 实时协作
- 分布式执行
