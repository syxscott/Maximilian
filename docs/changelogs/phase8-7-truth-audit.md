# Phase 8 — 任务 7: Truth Audit (隐藏路径检查)

**Date**: 2026-06-22
**Status**: ✅ Completed

## 修改文件

| 文件 | 修改 |
|------|------|
| `packages/meta-system/src/orchestrator.ts` | MetaOrchestrator.cycle() 路由所有 structural mutation( birth/retire/merge/split/promote/rebalance )经过 `pipeline.run()`,新增 `manualSaveBlueprint` / `manualRetireBlueprint` 显式钩子(避免 engine 回调绕过 pipeline) |
| `apps/api/src/index.ts` | `DIGITAL_TWIN_ENABLED=true` 时,AgentBirthEngine / AgentRetirementEngine / TeamOptimizer 不再注入 save/retire 回调;由 orchestrator 通过 `manualSaveBlueprint` / `manualRetireBlueprint` 在 pipeline+rollout 通过后显式调用 `blueprintStore.save` / `blueprintStore.retire` |
| `packages/meta-system/test/phase8-unit.test.ts` | 新增 "manualSaveBlueprint is called only after pipeline+rollout approval" 测试 |
| `docs/reports/phase8-truth-audit.md` | **新增** — 完整审计报告 |

## 隐藏路径扫描结果

| 决策点 | 文件:行 | 路径 | Phase 8 处理 |
|--------|---------|------|--------------|
| `registry.propose(...)` | orchestrator.ts:138 | 写入 `capability-registry/<id>.json` | 直接 — 发现阶段,无 mutation 到团队结构 |
| `registry.transition(... → "experimental")` | orchestrator.ts:161 | 写 `capability-registry/<id>.json` | 直接 — 仅元数据变更 |
| `registry.transition(... → "active")` | orchestrator.ts:190 | 写 `capability-registry/<id>.json` | **PIPELINE** (`runPromotionProposal`) |
| `registry.transition(... → "active")` | orchestrator.ts:199 | 写 `capability-registry/<id>.json` | 直接 — Phase 7 回退路径,当 `pipeline` 未注入 |
| `birth.birth(c)` | orchestrator.ts:232 | 调用 `saveBlueprint` 回调 → `blueprintStore.save` | **PIPELINE** + `manualSaveBlueprint`(当 Phase 8) |
| `birth.birth(c)` | orchestrator.ts:246 | 调用 `saveBlueprint` 回调 | 直接 — Phase 7 回退 |
| `retirement.evaluateAll(...)` | orchestrator.ts:261 | 调用 `retireBlueprint` 回调 → `blueprintStore.retire` | **PIPELINE** + `manualRetireBlueprint`(当 Phase 8) |
| `metaAgent.decide(...)` | orchestrator.ts:314 | 只返回 plan,无 mutation | N/A |
| `teamOptimizer.suggest(...)` | orchestrator.ts:365 | 只返回 hint | N/A |
| `teamOptimizer.applyHint(...)` | orchestrator.ts:388 | `applyToBlueprintStore` 回调 → 写 metadata | **PIPELINE**(每个 suggestion 转 Proposal) |
| `teamOptimizer.applyHint(...)` | (Phase 7 fallback) | 直接 apply | 仅当 Phase 8 未启用 |

## 关键修复

**之前的问题**:`AgentBirthEngine.birth(c)` 在 `if (this.deps.saveBlueprint)` 时直接调用回调。即使 orchestrator 把 `birth.birth(c)` 放在 pipeline 通过后才调用,engine 仍会通过自己的 callback 写盘。

**修复**:
- API 层(`apps/api/src/index.ts`)在 `DIGITAL_TWIN_ENABLED=true` 时,**不传入** `saveBlueprint` / `retireBlueprint` / `applyToBlueprintStore` 三个回调
- `MetaOrchestrator` 新增 `manualSaveBlueprint` / `manualRetireBlueprint` 两个显式钩子,仅在 pipeline.approved && rollout.applied 通过后才调用
- 测试覆盖 "manualSaveBlueprint is called only after pipeline+rollout approval"

## 测试

新增 1 个 orchestrator 测试:`manualSaveBlueprint is called only after pipeline+rollout approval`。

总测试: 102 → 103 → 107(meta-unit + phase8-unit)→ +6 e2e (api/test/e2e-phase8.test.ts)

最终:Phase 8 新增 33 单元 + 6 e2e = **+39 测试**
## 审计方法

```bash
# 1. 列出所有 mutation 调用
grep -nE "this\.deps\.(birth|retirement|registry|teamOptimizer|metaAgent)" packages/meta-system/src/orchestrator.ts

# 2. 确认每次都被 pipeline 包裹
# (手工 review 上面表格中每个决策点)

# 3. 验证 engine 回调在 Phase 8 模式下被禁用
grep -n "saveBlueprint\|retireBlueprint\|applyToBlueprintStore" apps/api/src/index.ts
```

完整审计报告见 [`docs/reports/phase8-truth-audit.md`](../reports/phase8-truth-audit.md)。