# Changelog — 2026-06-22 (DAGS 阶段 1：Capability Analyzer)

## 完成内容

实现 `CapabilityAnalyzer` 与 `CapabilityLibrary`，支持：
- 内嵌 11 个常见能力（product_design / frontend / backend / database / devops / testing / research_analysis / data_visualization / writing / review / general）
- 关键词检测（中英文）
- 依赖展开（transitive）
- 动态注册新能力
- `alwaysInclude` / `neverInclude` 选项

## 修改文件

无

## 新增文件

- `packages/dags/src/types.ts` — Capability、ToolSpec、AgentBlueprint、TeamGraph 等核心类型
- `packages/dags/src/capability-library.ts` — 内嵌能力库 + 注册/查询 API
- `packages/dags/src/capability-analyzer.ts` — 关键词匹配 + 依赖展开

## 删除文件

无

## API 变化

新增模块：`@max/dags` 包
```ts
import { CapabilityLibrary, CapabilityAnalyzer } from "@max/dags";
```

## 数据结构变化

| 类型 | 字段 |
|---|---|
| `Capability` | id, displayName, description, category, keywords, defaultGoal, promptTemplate, defaultTools, defaultConstraints, dependsOn, tags |
| `CapabilityCategory` | product / frontend / backend / data / devops / testing / research / writing / review / general |

## 风险

- **R1 能力识别准确率低**（高）：纯关键词匹配可能漏识别。后续可加 LLM 推断层
- **R8 能力库污染**（低）：标签化分组 + 后续可加 `cleanupUnused()`

## 后续工作

- 阶段 2：实现 BlueprintGenerator，把 Capability 物化为 Blueprint
