# Changelog — 2026-06-22 (Phase 5.4：Self-Evolution Planner)

## 完成内容

实现 `EvolutionPlanner.plan(input)`：
- 默认配置：`minExecutions=10, scoreThreshold=6.0, acceptanceThreshold=0.5`
- 决策：`avgScore < 6.0 || acceptance < 0.5` → 触发 evolution
- 否则返回 `null`
- 触发时生成 `EvolutionPlan`：
  - `changes[]` — 主要是 systemPrompt 调整（基于 failurePatterns + suggestions + userFeedback）
  - `expectedImprovement` — 预估提升
  - `basedOn` — 决策依据

版本号递增：`nextVersion("v1") → "v2"`, `"v10" → "v11"`

存储：`<rootDir>/evolution-plans/<planId>.json`

## 修改文件

无

## 新增文件

- `packages/autonomy/src/evolution-planner.ts` — `EvolutionPlanner`
- `packages/autonomy/src/types.ts` — `EvolutionPlanSchema` / `PlanChangeSchema`
- `packages/autonomy/test/autonomy-unit.test.ts` — 5.4 单元测试（5 个）

## 删除文件

无
