# Changelog — 2026-06-22 (DAGS 阶段 3：Dynamic Agent Factory)

## 完成内容

实现 `DynamicAgentFactory`：
- 从 Blueprint 实例化 `BlueprintAgent`（继承自 `@max/core` 的 `Agent` 基类）
- 注入蓝本 systemPrompt + 记忆 prelude
- 解析 `(provider, model)` 决定实际 LLM
- 执行后异步更新 Blueprint 统计（totalTasks, avgExecutionTimeMs, lastUsedAt）

## 修改文件

无

## 新增文件

- `packages/dags/src/dynamic-agent-factory.ts` — 动态 Agent 构造器

## 删除文件

无

## API 变化

```ts
import { DynamicAgentFactory } from "@max/dags";

const factory = new DynamicAgentFactory(store);
const agent = factory.create({
  blueprint, provider, model: "gpt-4o", memoryPrelude: "...", store,
});
const result = await agent.execute(task, ctx);
```

## 数据结构变化

`BlueprintAgent` 是 `Agent` 的子类，新增字段：
- `blueprint`：构造时的蓝本引用
- `assignedProvider` / `assignedModel`：本实例绑定的 LLM
- `memoryPrelude`：注入到 systemPrompt 的记忆段

执行返回的 `Result.metadata` 包含 `blueprintId` / `blueprintVersion` / `provider`，便于追溯。

## 风险

- **R5 并发写冲突**（中）：统计写是 fire-and-forget；多次并发时取最后写入即可
- **R10 动态 Agent 与静态 AgentRole 类型冲突**（中）：通过 cast `as AgentManifest["role"]` 解决（运行时不再校验）

## 后续工作

- 阶段 4：从多个 Blueprint 构建 TeamGraph
