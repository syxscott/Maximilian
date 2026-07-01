# Changelog — 2026-06-22 (DAGS 阶段 5：Model Assignment)

## 完成内容

实现 `ModelAssigner`：
- 调用 `EvolutionFacade.selectForRole(role)` 为每个 TeamNode 选 (provider, model)
- 把选中的 (provider, model) + reason + score 写回 `node.modelAssignment`
- 同步落盘到 graph
- 提供 `resolveProvider()` 与 `buildAgentContexts()` 给阶段 3 工厂使用

## 修改文件

无

## 新增文件

- `packages/dags/src/model-assigner.ts`

## 删除文件

无

## API 变化

```ts
import { ModelAssigner } from "@max/dags";

const assigner = new ModelAssigner(evolutionFacade, store);
const updated = await assigner.assign(graph);
// updated.nodes[].modelAssignment = { provider, model, reason, score }
```

## 数据结构变化

`TeamNode.modelAssignment`：
```ts
{
  provider: string;
  model: string;
  reason: string;
  score: number;
}
```

## 风险

- **R4 冷启动无历史**：Evolution Engine fallback 到 provider.defaultModel（已实现）
- **R11 模型分配与执行一致**：`provider.id` 强制对齐；测试覆盖

## 后续工作

- 阶段 6：用 3 个不同请求验证
