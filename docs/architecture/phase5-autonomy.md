# Phase 5 — Autonomous Improvement Loop (AIL)

**Status**: Active
**Date**: 2026-06-22
**Author**: Maximilian

## 1. 背景

Phase 1-4 让 Maximilian 具备了"自组织"能力：

- DAGS 根据请求生成团队
- Evolution Engine 跟踪指标、选择模型
- Blueprint 可被版本化

但这些能力都是**被动**的：
- 人类决定何时升级
- Agent 不知道自己哪里不好
- 失败不会自动转化为改进

Phase 5 实现 **Autonomous Improvement Loop**：系统观察到失败 → 自动规划 → 自动生成候选 → A/B 验证 → 自动晋升。

## 2. 设计目标

| 目标 | 描述 |
|---|---|
| **可回放** | 任意任务的执行上下文可被完整重建 |
| **可解释** | Review 输出结构化，能被 Planner 消费 |
| **可发现** | 失败模式从历史中自动浮现 |
| **可规划** | EvolutionPlan 描述要改什么、为什么改 |
| **可验证** | A/B 满足阈值才晋升，否则丢弃 |
| **可审计** | promotion-history 永久落盘 |

## 3. 闭环

```
                ┌────────────────────────────────────┐
                │          User Request              │
                └──────────────┬─────────────────────┘
                               ▼
                ┌────────────────────────────────────┐
                │   DAGS.compose()                   │
                │   (capability → blueprint → graph) │
                └──────────────┬─────────────────────┘
                               ▼
                ┌────────────────────────────────────┐
                │   Runtime.execute()                │
                │   - each task = one execution      │
                └──────────────┬─────────────────────┘
                               ▼
                ┌────────────────────────────────────┐
                │   Review Intelligence              │
                │   score + strengths + weaknesses   │
                │   + failure_patterns + suggestions │
                └──────────────┬─────────────────────┘
                               ▼
                ┌────────────────────────────────────┐
                │   ExecutionStore.save()            │
                │   (full context: task, blueprint,  │
                │    graph, model, artifacts, review)│
                └──────────────┬─────────────────────┘
                               ▼
                ┌────────────────────────────────────┐
                │   FailurePatternAnalyzer           │
                │   - mine insights/                │
                └──────────────┬─────────────────────┘
                               ▼
                ┌────────────────────────────────────┐
                │   EvolutionPlanner.plan()          │
                │   - should evolve?                │
                │   - what to change?                │
                │   - output: EvolutionPlan          │
                └──────────────┬─────────────────────┘
                               ▼
                ┌────────────────────────────────────┐
                │   CandidateGenerator.create()      │
                │   - v2 / v3 / v4                   │
                │   - reference feedback             │
                └──────────────┬─────────────────────┘
                               ▼
                ┌────────────────────────────────────┐
                │   PromotionEngine.decide()         │
                │   - A/B on N tasks                 │
                │   - rule: score↑≥10% AND accept↑≥15%│
                │   - sample ≥ 20                    │
                └──────────────┬─────────────────────┘
                               ▼
                ┌────────────────────────────────────┐
                │   (next request)                   │
                │   - reuses promoted candidate      │
                └────────────────────────────────────┘
```

## 4. 关键设计决策

| ADR | 决策 |
|---|---|
| [ADR-015](../decisions/adr-015-execution-replayable.md) | ExecutionRecord 必须包含完整回放所需的所有上下文 |
| [ADR-016](../decisions/adr-016-structured-review.md) | Review 必须输出结构化 JSON（含 failure_patterns） |
| [ADR-017](../decisions/adr-017-ab-promotion.md) | A/B 晋升必须满足双阈值（score + acceptance） |
| [ADR-018](../decisions/adr-018-dags-mode.md) | `DAGS_MODE=true` 让 DAGS 接管 `/api/chat` |

## 5. 模块划分

新增包 `@max/autonomy`：

| 模块 | 阶段 | 持久化 |
|---|---|---|
| `ExecutionStore` | 5.1 | `executions/<id>.json` |
| `ReviewIntelligence` | 5.2 | `reviews/<taskId>.json` |
| `FailurePatternAnalyzer` | 5.3 | `insights/failure-patterns.json` |
| `EvolutionPlanner` | 5.4 | `evolution-plans/<id>.json` |
| `CandidateGenerator` | 5.5 | `candidates/<role>-v<n>.json` |
| `PromotionEngine` | 5.6 | `promotion-history.json` |
| `LearningAPI` | 5.7 | （仅查询，不落盘） |
| `AutonomyOrchestrator` | 5.8 | （编排，不落盘） |

## 6. 与现有模块的关系

- **DAGS**：每个 task 关联到一次 graph run；graph id 写入 ExecutionRecord
- **Evolution Engine**：复用 MetricsStore / Leaderboard 作为数据源
- **Workspace**：execution 记录引用 workspace.id，但不修改 workspace.json
- **Runtime**：不被修改；通过 listener 钩入

## 7. 验证标准

- 30+ 单元测试
- 3 集成测试
- 1 端到端测试
- 所有文档落盘
- 零回归
- `/api/chat` 在 DAGS_MODE=true 时返回 DAGS 路径
- promotion-history 记录至少一次成功晋升
