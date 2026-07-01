# Changelog — 2026-06-22 (DAGS 设计文档)

## 完成内容

- 创建 `docs/` 目录树（architecture / decisions / milestones / changelogs / reports / agent-designs）
- 生成 6 份核心设计文档：
  - `architecture/phase4-dags.md` — DAGS 总体架构
  - `architecture/agent-lifecycle.md` — Agent 生命周期图
  - `architecture/team-graph-schema.md` — Team Graph 数据结构
  - `architecture/blueprint-schema.md` — AgentBlueprint Schema
  - `architecture/capability-schema.md` — Capability Schema
  - `reports/phase4-risk-analysis.md` — 12 项风险登记
- 生成 4 份 ADR（ADR-011 至 ADR-014）

## 新增文件

- `docs/architecture/phase4-dags.md`
- `docs/architecture/agent-lifecycle.md`
- `docs/architecture/team-graph-schema.md`
- `docs/architecture/blueprint-schema.md`
- `docs/architecture/capability-schema.md`
- `docs/reports/phase4-risk-analysis.md`
- `docs/decisions/adr-011-capability-first.md`
- `docs/decisions/adr-012-blueprint-persistence.md`
- `docs/decisions/adr-013-team-graph-dag.md`
- `docs/decisions/adr-014-model-assignment-from-history.md`

## 删除文件

无

## API 变化

无（设计阶段）

## 数据结构变化

| 类型 | 说明 |
|---|---|
| `Capability` | 新增概念：能力是 Agent 的第一公民 |
| `AgentBlueprint` | 描述如何构造一个 Agent |
| `TeamGraph` | 团队结构的有向无环图 |
| `TeamNode` / `TeamEdge` / `TeamLayer` | 节点 / 边 / 并行层 |

## 风险

详见 `reports/phase4-risk-analysis.md`（共 12 项）

## 后续工作

- 阶段 1：实现 CapabilityAnalyzer
- 阶段 2：实现 BlueprintGenerator
- 阶段 3：实现 DynamicAgentFactory
- 阶段 4：实现 TeamGraphBuilder
- 阶段 5：实现 ModelAssigner
- 阶段 6：三案例验证
