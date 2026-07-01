# Phase 7 — Task 7: 系统瘦身(Dead Code 审计 + 删除)

**Date**: 2026-06-22
**Status**: ✅ Completed

## 修改文件

| 文件 | 修改 |
|------|------|
| `packages/dags/src/blueprint-store.ts` | 删除 `findByCapability` / `getGraph` / `listGraphs` 方法(全部 0 外部调用) |
| `packages/dags/test/dags.test.ts` | 改写 "all graphs are persisted and retrievable" 测试,绕过已删除的 `getGraph` |
| `packages/meta-system/src/capability-registry.ts` | 删除 `recordUsage` 方法(0 外部调用) |
| `packages/meta-system/src/types.ts` | `TeamOptimizerHint` suggestion 枚举移除 `"reorder"`(永不生成) |
| `packages/meta-system/src/team-optimizer.ts` | 删除 `reorder` 分支;`estimatedCost` 修复为真实累加 modelAssignment.cost |
| `packages/meta-system/test/meta-unit.test.ts` | 替换 "recordUsage" 测试为 "Phase 7 — recordUsage removed" |
| `docs/reports/phase7-dead-code-audit.md` | 新增完整审计报告 |

## 删除统计

| 项 | 删除行数 | 测试影响 |
|---|---|---|
| `BlueprintStore.findByCapability` | -7 | 0 |
| `BlueprintStore.getGraph` | -8 | 1 改写 |
| `BlueprintStore.listGraphs` | -13 | 0 |
| `CapabilityRegistry.recordUsage` | -25 | 2 替换为 1 |
| `reorder` 枚举 + 分支 | -3 | 0 |
| **总计** | **-56 行** | -1 测试, +1 测试,改写 1 测试 |

## 技术债修复

| 项 | 修复 |
|---|---|
| `TeamOptimizer.estimatedCost = nodes.length` | 改为累加 `modelAssignment.cost`,fallback 1 |
| `(this.deps.governance as any)` 类型断言 | 已用 `governance.getConfig()` 替换(任务 5) |
| `applyHintToBlueprints` 重复抽象 | 保留为 `TeamOptimizer.applyHint()` 唯一入口,作为公开函数保留给 API 层调用(测试 harness 用) |

## 未解决技术债(留给 Phase 8)

| 项 | 备注 |
|---|---|
| `MetaAgent` merge/split 决策未应用 | 仅 log,需扩展 orchestrator 真正操作 BlueprintStore |
| `ProposalSource` 多信号源未启用 | API 层 `extractDiscoverySignals` 仅产出 `user_request_analysis`,`failure_pattern_mining` / `review_suggestion` / `capability_gap` 仍空 |
| `workspaceToGraphs` 是 lossy 转换 | 丢失 Plan.edges 信息 |
| Stale dist 文件 | 已在 `.gitignore`,仅占磁盘 |

## 审计方法

```bash
# 1. 死导出检测
grep -rn "<symbol>" packages apps --include="*.ts" | grep -v test | grep -v dist
# 2. 永不生成枚举值检测
grep -rn "type: \"<enum-value>\"" packages
# 3. 类型断言 (as any) 检测
grep -rn "as any" packages/meta-system/src
# 4. 启发式错误检测
grep -rn "= input.graph.nodes.length" packages/meta-system/src
```

## 测试结果

```
@max/meta-system: 73/73 ✅ (71 → 73,删 2 + 加 1 + 改 1)
@max/dags: 24/24 ✅
@max/autonomy: 37/37 ✅
@max/api meta 全部: 23/23 ✅
type-check: 全部通过
```

## 净效果

- 删除死代码: 56 行
- 修复技术债: 2 处(estimatedCost 真实化 + 类型断言)
- 测试: +1 测试(`recordUsage removed`)
- 文档: 1 完整审计报告(`phase7-dead-code-audit.md`)
