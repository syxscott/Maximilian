# Phase 7 — Task 5: Governance 真阻断

**Date**: 2026-06-22
**Status**: ✅ Completed

## 修改文件

| 文件 | 修改 |
|------|------|
| `packages/meta-system/src/governance.ts` | `GovernanceEngine` 新增 `getConfig()` 方法,允许 orchestrator 在 mutation 前读取当前 limits |
| `packages/meta-system/src/orchestrator.ts` | cycle() 增加早期 + 终期双检查;`birthBudget` 跟踪已生成 agent 数;`MetaAgent` "create" 决策与 active promotion 均受 maxAgents/maxCapabilities 限制;`MetaCycleResult` 新增 `blockedBy: string[]` 字段 |
| `packages/meta-system/test/meta-unit.test.ts` | 新增 3 个 governance 硬阻断单测 (71→74) |

## 修改原因

Phase 6 中 `GovernanceEngine.check()` 返回 `allowed: false` 仅导致 `orgMemory.record("governance_violation")`,**没有任何代码路径会根据这个值真正拒绝 mutation**。也就是说,maxAgents=20 在配置上限制了,但实际系统可以无限创建 agent,只要 `cycle()` 一直在跑。

要求:`allowed=false` 时禁止 create agent / create capability / promotion,必须返回错误而非仅记录日志。

## 架构变化

```
Before (Phase 6):
  cycle() {
    discover → propose
    promote proposed → experimental → active        ← 无阻断
    birth for each activated                        ← 无阻断
    retire
    decide
    suggest
    governance.check() → orgMemory.record(violation) ← 仅日志,不阻止任何东西
  }

After (Phase 7 Task 5):
  cycle() {
    baseline = governance.check()                   ← 早期检查
    if !baseline.allowed: blockedBy.push(reason)
    
    discover → propose                             ← 始终允许(advisory)
    
    if !blocked(maxCapabilities):
      for each proposed: transition → experimental → active
        if projected_active >= maxCapabilities:     ← 中途检查
          blockedBy.push(maxCapabilities)
          break
    
    if !blocked(maxAgents):
      for each activated:
        if birthBudget >= maxAgents:
          blockedBy.push(maxAgents)
          break
        birth() → birthBudget++
    
    retire                                          ← 始终允许(降低占用)
    
    for each metaAgent decision:
      if decision.action == "create":
        if birthBudget >= maxAgents:
          blockedBy.push(maxAgents)
          continue                                  ← 跳过此决策
    
    teamHint
    
    final = governance.check()                     ← 终期检查
    return { ..., blockedBy }
  }
```

## 阻断语义

| 操作 | 被阻断条件 | 行为 |
|------|----------|------|
| `registry.propose()` | 永远允许 | 总是写;超过 maxCapabilities 时不再 promote 到 active |
| `registry.transition(...active)` | 当前 active 数 ≥ maxCapabilities | 跳过 promotion,记入 blockedBy |
| `birth.birth(...)` | 当前 agent 数 ≥ maxAgents | 跳过 birth,记入 blockedBy |
| `metaAgent.decide().create` | birthBudget ≥ maxAgents | 跳过决策记录,记入 blockedBy |
| `evaluateAll(retire)` | 永远允许 | 退役降低占用,反而帮助 governance |

## 测试

新增 3 个单测:

| 测试 | 验证 |
|------|------|
| `hard-blocks births when maxAgents reached` | 1 个已存在 blueprint + maxAgents=1 → 0 birth + blockedBy 包含 "maxAgents" |
| `hard-blocks promotions when maxCapabilities reached` | 1 个 active capability + maxCapabilities=1 → 新 capability 不被 promote + active 计数仍为 1 |
| `reports blockedBy list even when one mutation succeeds` | maxAgents=2 + 3 个 signals → births ≤ 2 + 部分被阻断时 blockedBy 非空 |

## 风险

| 风险 | 缓解 |
|------|------|
| 阻断后 cycle 留下 "中间状态"(部分 promote / 部分 birth) | 设计如此:尽量做能做的,记录做不了的 |
| `birthBudget` 只跟踪本 cycle 创建,不跟踪并发 | 串行调用已是现状约束 |
| governance 阻断检查没有考虑将要退役的 agent | 顺序:birth 先做,retire 随后,后续 cycle 自然减数 |

## 测试结果

```
@max/meta-system: 74/74 ✅ (71 + 3 new)
@max/api meta: 17/17 ✅
type-check: 全部通过
```
