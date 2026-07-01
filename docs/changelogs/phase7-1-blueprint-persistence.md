# Phase 7 — Task 1: Blueprint 真落盘

**Date**: 2026-06-22
**Status**: ✅ Completed

## 修改文件

| 文件 | 修改 |
|------|------|
| `packages/dags/src/dags.ts` | `DAGSOptions` 新增 `store?` 字段;构造函数优先使用外部 `BlueprintStore` |
| `apps/api/src/index.ts` | 引入共享 `BlueprintStore`;`AgentBirthEngine` 注入 `saveBlueprint` 回调;`AgentRetirementEngine` 注入 `retireBlueprint` 回调;DAGS 构造传入共享 store |

## 修改原因

Phase 6.5 审计发现:`AgentBirthEngine.birth()` 虽然接受 `saveBlueprint` 回调,但 API 层从未注入,导致新生成的 AgentBlueprint 只写到 `<rootDir>/agent-births/<id>.json` 审计目录,**完全没有进入 `BlueprintStore`,DAGS 在下次 `compose()` 时找不到这些蓝图**。

同理,`AgentRetirementEngine.evaluateAll()` 的 `retireBlueprint` 回调也未注入,退役决策只是写 `org-events`,不修改 `BlueprintStore.retire()`,导致下一次 `DAGS.compose()` 仍把退役 agent 当作可用。

## 架构变化

```
Before (Phase 6):
  AgentBirthEngine({rootDir}) → agent-births/<id>.json (audit only)
  AgentRetirementEngine()     → org-events/<id>.json (audit only)
  DAGS.compose() → static CAPABILITY_LIBRARY + own BlueprintStore
  (No integration between meta-system birth and DAGS team generation)

After (Phase 7 Task 1):
  ┌──────────────────────────────────────────┐
  │ sharedBlueprintStore = new BlueprintStore(workspaceDir)
  └────────┬─────────────────────────────────┘
           │
           ├─ DAGS({ store: sharedBlueprintStore })   ← reads/writes here
           │
           ├─ AgentBirthEngine({ saveBlueprint: bp => sharedBlueprintStore.save(bp) })
           │   → workspace/blueprints/<id>.json ✅ (real disk write)
           │
           └─ AgentRetirementEngine({ retireBlueprint: id => sharedBlueprintStore.retire(id) })
               → blueprint.retiredAt = now ✅ (real state mutation)
```

## 风险

| 风险 | 缓解 |
|------|------|
| 两个 BlueprintStore 实例可能冲突 | 通过 `opts.store` 共享同一实例,所有写入路径都到同一文件系统目录 |
| 回调失败导致 cycle 部分完成 | AgentBirthEngine 当前在 `saveBlueprint` 失败时不会重试,审计文件仍写入;改进在 Task 7(瘦身)处理 |
| 退役回调中无权限检查 | 仅退役低分/低使用,无敏感数据;OK |

## 测试结果

```
@max/meta-system: 71/71 ✅
@max/api meta: 17/17 ✅ (10 集成 + 7 E2E)
@max/dags: 24/24 ✅ (无回归)
@max/autonomy: 37/37 ✅ (无回归)
type-check: 全部通过
```
