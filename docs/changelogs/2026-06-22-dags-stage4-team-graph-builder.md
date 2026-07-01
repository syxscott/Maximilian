# Changelog — 2026-06-22 (DAGS 阶段 4：Team Graph Builder)

## 完成内容

实现 `TeamGraphBuilder`：
- 一份 Blueprint 列表 → 一张 DAG
- 节点依赖由 `producerFor(role)` 决定（产品→后端→前端→测试/文档）
- Reviewer 节点自动依赖所有非 Reviewer 节点
- Kahn 算法拓扑排序 + 分层
- 循环检测：stuck 节点非空 → 抛错
- 落盘到 `workspace/graphs/<id>.json`

## 修改文件

无（仅在 dags 包内新增）

## 新增文件

- `packages/dags/src/team-graph-builder.ts`

## 删除文件

无

## API 变化

```ts
import { TeamGraphBuilder } from "@max/dags";

const graph = new TeamGraphBuilder().build(blueprints, userRequest, capabilities);
// graph.layers → 并行执行层
// graph.edges  → data_flow / review
```

## 数据结构变化

| 类型 | 字段 |
|---|---|
| `TeamGraph` | id, userRequest, capabilities, nodes, edges, layers, createdAt, status |
| `TeamNode` | id, blueprintId, role, displayName, dependsOn, modelAssignment? |
| `TeamEdge` | from, to, type: "data_flow" \| "review" \| "validation" |
| `TeamLayer` | index, nodeIds[] |

## 风险

- **R3 Team Graph 循环**（高）：Kahn 算法 + 循环检测
- **R11 节点类型与 Agent 角色映射**：节点 `role` 是 string，运行时透传

## 后续工作

- 阶段 5：把 TeamGraph 喂给 ModelAssigner 决定每个节点用哪个 (provider, model)
