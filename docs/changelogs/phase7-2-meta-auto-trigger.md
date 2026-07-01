# Phase 7 — Task 2: Meta 自动触发

**Date**: 2026-06-22
**Status**: ✅ Completed

## 修改文件

| 文件 | 修改 |
|------|------|
| `apps/api/src/index.ts` | `runtime.on()` 监听 `done` 事件时,在 evolution 处理后自动调用 `metaOrchestrator.cycle()`;新增 `extractDiscoverySignals()` 与 `workspaceToGraphs()` 辅助函数;新增 `DiscoverySignal` 类型导入 |

## 修改原因

Phase 6 中 `MetaOrchestrator.cycle()` 只能通过手动 `POST /api/meta/cycle` 触发,在生产路径中没有任何代码调用它,导致 meta-system 永远不会自启动。

用户的真实意图是:每个 workspace 完成后(Evolution 已处理完自己的事),meta-system 应该自动触发一次 cycle,产出新的 capability / agent / 退役决策 —— 形成:

```
chat → DAGS.compose → AgentRuntime → done → Evolution(已存在)
                                    ↓
                              MetaOrchestrator.cycle(新增)
                                    ↓
                       capability / agent / 退役
```

## 架构变化

```
Before (Phase 6):
  done event → evolution.attachReviewScores → evolution.maybeEvolve (END)
  meta-system 仅靠 POST /api/meta/cycle 手动触发

After (Phase 7 Task 2):
  done event → evolution.attachReviewScores → evolution.maybeEvolve
                                            ↓
                                  metaOrchestrator.cycle() (新增)
                                            ↓
                  ┌─────────────────────────┼─────────────────────────┐
                  │                         │                         │
                  ▼                         ▼                         ▼
          extractDiscoverySignals   executionStore.listAll   blueprintStore.listAll
          workspaceToGraphs
                                            ↓
                              CycleResult (births / retirements / proposals)
                                            ↓
                                       console.log summary
```

## 风险

| 风险 | 缓解 |
|------|------|
| cycle() 抛错影响 done event 流程 | 用 try/catch 包裹,错误仅 log,不中断 runtime 事件流 |
| 频繁 cycle 拖慢响应 | 每次 done 仅触发一次;后续可加节流(Phase 8 候选) |
| workspace 无 plan/无 results | signals 为空,graphs 为空数组,cycle 仍然安全执行 |
| metaOrchestrator 未初始化时 callback 触发 | `if (metaOrchestrator && executionStore)` 守卫;callback 在 done 时触发,此时模块初始化已完成 |

## 测试结果

```
@max/meta-system: 71/71 ✅
@max/api meta: 17/17 ✅ (10 集成 + 7 E2E)
type-check: 全部通过
```
