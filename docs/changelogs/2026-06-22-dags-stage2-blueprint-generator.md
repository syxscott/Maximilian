# Changelog — 2026-06-22 (DAGS 阶段 2：Blueprint Generator)

## 完成内容

实现 `BlueprintGenerator` 与 `BlueprintStore`：
- 根据能力列表生成 AgentBlueprint
- 同类能力按 category 自动归并到同一角色
- prompt 模板使用 `{{userRequest}}` 占位符
- 支持 `reuseExisting` 模式（命中已有蓝本）
- 落盘到 `workspace/blueprints/<id>.json`

## 修改文件

无

## 新增文件

- `packages/dags/src/blueprint-store.ts` — Blueprint + Graph 持久化
- `packages/dags/src/blueprint-generator.ts` — 物化能力为 Blueprint

## 删除文件

无

## API 变化

```ts
import { BlueprintGenerator, BlueprintStore } from "@max/dags";

const store = new BlueprintStore(rootDir);
const gen = new BlueprintGenerator(library, store);
const blueprints = await gen.generate(["frontend", "backend"], { userRequest: "..." });
```

## 数据结构变化

| 字段 | 说明 |
|---|---|
| `AgentBlueprint.id` | 形如 `bp-frontend-a1b2c3d4` |
| `AgentBlueprint.role` | 归并后的角色名（frontend / backend / data_engineer / ...） |
| `AgentBlueprint.systemPrompt` | 由 promptTemplate 注入 userRequest 后拼接 |
| `AgentBlueprint.capabilities` | 覆盖的能力 ID 列表 |
| `AgentBlueprint.preferredModels` | 模型提示（不强制） |
| `AgentBlueprint.stats` | 使用统计（被阶段 3 维护） |
| `AgentBlueprint.version` | "v1" / "v2" / ...（用于 evolution 链） |
| `AgentBlueprint.parentId` | 父蓝本（用于 evolution 链） |

## 风险

- **R2 Blueprint 质量方差大**（中）：当前 prompt 是模板拼接；未来可用 LLM 改写
- **R5 并发写冲突**（中）：每个 teamId 独立；append-only JSON 缓解

## 后续工作

- 阶段 3：从 Blueprint 实例化 Agent
