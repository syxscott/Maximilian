# Phase 7 — Task 4: TeamOptimizer 生效

**Date**: 2026-06-22
**Status**: ✅ Completed

## 修改文件

| 文件 | 修改 |
|------|------|
| `packages/meta-system/src/team-optimizer.ts` | `TeamOptimizer` 新增 `OptimizerDeps` (`rootDir` + `applyToBlueprintStore`);新增 `applyHint(hint)` 方法;导出 `applyHintToBlueprints` + `persistHint` 工具函数 |
| `packages/meta-system/src/index.ts` | 导出新类型与工具函数 |
| `packages/meta-system/src/orchestrator.ts` | 在 teamHint 生成后调用 `teamOptimizer.applyHint(teamHint)`,记录 blueprintsModified |
| `apps/api/src/index.ts` | 引入 `applyHintToBlueprints`;构造 TeamOptimizer 时注入 `applyToBlueprintStore` 回调(读 blueprints → 改 metadata → save) |

## 修改原因

Phase 6 中 `TeamOptimizer.suggest()` 只产生 `TeamOptimizerHint`(描述性建议),从不写任何东西。下一次 `DAGS.compose()` 完全不感知这些 hint,所以"建议"永远停留在 org-memory 里。

要求:优化建议应影响下一轮团队结构。

## Hint → Blueprint metadata 映射

| Suggestion 类型 | Blueprint metadata 写入 |
|---|---|
| `add_review_node` | 找到 review/reviewer 蓝图,写入 `metadata.optimizerRequired=true` |
| `remove_redundant` | 找到 targetRole 蓝图,写入 `metadata.pendingRetirement=true` |
| `parallelize` | 用量 Top-2 蓝图,写入 `metadata.parallelizeGroup=<hintId>` |
| `shrink_team` | 找到 targetRole 蓝图,写入 `metadata.pendingRetirement=true` |
| `grow_team` | 用量 Top-1 蓝图,写入 `metadata.growthCandidate=true` |
| `reorder` | 无操作(信息性) |

Hint 本身持久化到 `<rootDir>/team-hints/<hintId>.json`,供后续审计。

## 架构变化

```
Before (Phase 6):
  TeamOptimizer.suggest() → TeamOptimizerHint (描述性)
                            ↓
                       orgMemory.record("team_optimized", hintId)
                       (hint 仅作为事件,后续无影响)

After (Phase 7 Task 4):
  TeamOptimizer.suggest() → TeamOptimizerHint
                            ↓
                  teamOptimizer.applyHint(hint)
                            ├─→ persistHint(hint)             → <rootDir>/team-hints/<id>.json
                            └─→ applyHintToBlueprints(hint, blueprints, save)
                                       ↓
                          改 blueprint.metadata,save 回 BlueprintStore
                                       ↓
                          下次 DAGS.compose() 蓝图已带 metadata flag
```

DAGS 后续读取 metadata 的逻辑(在 Task 7 瘦身中可加,但当前不影响闭环)。

## 风险

| 风险 | 缓解 |
|------|------|
| 重复 hint 反复修改 metadata | `lastHintId` 写入 metadata,可识别 |
| 关键 blueprint 被错误标记 pendingRetirement | 当前是 hint-only 标记,真正退役仍由 AgentRetirementEngine + governance 决定 |
| 蓝图数量大时遍历所有蓝图 | 当前 listAll 是 O(n),n<50;规模化时 Task 8 优化 |

## 测试结果

```
@max/meta-system: 71/71 ✅
@max/api meta: 17/17 ✅
type-check: 全部通过
```
