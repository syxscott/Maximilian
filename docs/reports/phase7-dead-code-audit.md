# Phase 7 — Dead Code Audit & Deletion Plan

**Date**: 2026-06-22
**Phase**: 7 — Meta-System Activation
**Status**: ✅ Audit complete, deletion plan ready

---

## TL;DR

| 类别 | 数量 | 严重度 |
|---|---|---|
| 完全无人调用的导出 | 5 | 中 |
| 已声明但永不生成的枚举值 | 1 | 低 |
| 重复抽象 | 2 | 低 |
| 技术债(类型不安全 / 启发式错误) | 4 | 中 |
| Stale 构建产物 | ~50 文件 | 低(已在 `.gitignore`) |

**可立即删除** ~120 行,**应当修复** 的 ~50 行。

---

## 1. 死代码 — 完全无人调用

### 1.1 `BlueprintStore.findByCapability` — 0 外部调用

```ts
// packages/dags/src/blueprint-store.ts:74
async findByCapability(capabilityId: string): Promise<AgentBlueprint[]> {
  const all = await this.listAll();
  return all.filter((b) => b.capabilities.includes(capabilityId) && !b.retiredAt);
}
```

**Grep 证据**:
```
$ grep -rn "findByCapability" packages apps --include="*.ts" | grep -v test
(no results)
```

**删除计划**:删除方法本身(7 行)。如未来需要,`listAll().filter()` 等价。

### 1.2 `BlueprintStore.getGraph` — 0 外部调用

```ts
// packages/dags/src/blueprint-store.ts:95
async getGraph(id: string): Promise<TeamGraph | undefined> { ... }
```

**Grep 证据**:
```
$ grep -rn "store.getGraph\|blueprintStore.getGraph" packages apps
(no results outside tests)
```

**删除计划**:删除方法(8 行)。`listGraphs()` 也未被外部调用,可一并删除。

### 1.3 `BlueprintStore.listGraphs` — 0 外部调用

```ts
// packages/dags/src/blueprint-store.ts:105
async listGraphs(): Promise<TeamGraph[]> { ... }
```

**删除计划**:删除方法(13 行)。

### 1.4 `CapabilityRegistry.recordUsage` — 0 外部调用

```ts
// packages/meta-system/src/capability-registry.ts:86
async recordUsage(id: string, score: number, durationMs: number): Promise<CapabilityRecord> {
  ...
  totalExecs = existing.totalExecutions + 1;
  ...
}
```

**Grep 证据**:
```
$ grep -rn "registry.recordUsage\|registry\\.recordUsage" packages apps
(no results outside tests)
```

**删除计划**:删除方法(25 行)。当前的 capability usage 通过 `executionStore.listForRole()` 在 orchestrator 外做统计,不需要 recordUsage。

### 1.5 `team-optimizer.reorder` 枚举值 — 永不生成

```ts
// packages/meta-system/src/types.ts:108-114
suggestions: z.array(z.object({
  type: z.enum([
    "add_review_node",
    "reorder",        // ← 枚举里但 TeamOptimizer.suggest() 从不生成
    "parallelize",
    "shrink_team",
    "grow_team",
    "remove_redundant",
  ]),
  ...
}))
```

**Grep 证据**:
```
$ grep -rn "type: \"reorder\"" packages
(no results)
```

**删除计划**:从枚举移除 `"reorder"`,在 `team-optimizer.ts` 同步移除分支(`else if (s.type === "reorder")`)。

---

## 2. 重复抽象 — 应统一

### 2.1 `applyHintToBlueprints` 与 `TeamOptimizer.applyHint`

两个函数做类似的工作:
- `TeamOptimizer.applyHint()` 调用 `applyToBlueprintStore` 回调
- `applyHintToBlueprints()` 是独立导出函数

**问题**:同一份逻辑(读 blueprints → 改 metadata → save)有两份入口。

**删除计划**:保留 `TeamOptimizer.applyHint()` 作为单一入口,`applyHintToBlueprints()` 改为内部实现,不导出。

### 2.2 `workspaceToGraphs` 在 API 层 vs 内置转换

`apps/api/src/index.ts:482` 定义 `workspaceToGraphs(workspace)`,把 `Plan.tasks` 转 `TeamGraph`。
这是 lossy 转换 —— 丢失了 Plan 的 edges 和真正 graph structure。

**删除计划**:
- 短期:保留(完整重构超出 Phase 7 范围)
- 长期(Phase 8):让 Plan 携带 `graphId` 字段,直接读 `BlueprintStore.getGraph()`

---

## 3. 技术债

### 3.1 `TeamOptimizer.estimatedCost` 启发式错误

```ts
// packages/meta-system/src/team-optimizer.ts:81
const estimatedCost = input.graph.nodes.length;
```

这是把"节点数"当成本,但实际成本应该来自每节点的成本(providers, model, tokens)。

**影响**:SimulationEngine 收到错误的 cost 数据。

**修复**:让 graph node 携带 `ModelAssignment`(已有),加总 `modelAssignment.cost` 字段。如无 assignment,fallback 到 1。

### 3.2 `MetaAgent` 的 merge/split/delete 决策永不应用

```ts
// packages/meta-system/src/orchestrator.ts:218-243
for (const d of changePlan.decisions) {
  if (d.action === "delete") {
    await this.deps.orgMemory.record("agent_retired", d.agentRole, ...);
  } else if (d.action === "merge") {
    await this.deps.orgMemory.record("agent_merged", ...);
  } else if (d.action === "split") {
    await this.deps.orgMemory.record("agent_split", ...);
  } else if (d.action === "create") {
    if (birthBudget >= maxAgents) {
      blockedBy.push(...);
      continue;
    }
    birthBudget++;
    await this.deps.orgMemory.record("agent_born", d.agentRole, ...);
  }
}
```

只有 `create` 被实际处理(`create` 在 budget 内也只是 log,不调 birth)。`merge`/`split`/`delete` 决策仅 log。

**修复**:Phase 8 候选。当前 SHADOW 状态:决策被审计,但不真正改变 BlueprintStore。

### 3.3 `DiscoverySignal.source` 永远 `"user_request_analysis"`

```ts
// apps/api/src/index.ts:467-481
function extractDiscoverySignals(workspace: Workspace): DiscoverySignal[] {
  signals.push({ ..., source: "user_request_analysis" });
  for (const r of workspace.results) {
    signals.push({ ..., source: "user_request_analysis" });  // 同样
  }
}
```

`ProposalSource` 枚举有 4 个值,但 API 只产生 `user_request_analysis`。`failure_pattern_mining` / `review_suggestion` / `capability_gap` 信号源从未真实产生。

**修复**:让 API 也从 `workspace.results[].metadata.review.suggestions` 提取 `review_suggestion` 信号;从 `executionStore` 的 failed execs 提取 `failure_pattern_mining` 信号。

### 3.4 `(this.deps.governance as any)` 类型断言

Phase 7 Task 5 修复了 → 已替换为 `governance.getConfig()`。✅ 已解决。

---

## 4. Stale 构建产物

```
packages/meta-system/dist/         (~32 文件)
packages/dags/dist/                (~32 文件)
packages/autonomy/dist/            (~32 文件)
apps/api/dist/                     (~16 文件)
```

全部在 `.gitignore` 中(`dist/`),**不算 dead code**,只是占磁盘。
清理:`pnpm clean` 或 `rm -rf packages/*/dist apps/*/dist`。

---

## 5. 删除计划汇总

| 项 | 类型 | 行数 | 风险 | 优先级 |
|---|---|---|---|---|
| 删 `BlueprintStore.findByCapability` | 死代码 | -7 | 无 | 🟢 P3 |
| 删 `BlueprintStore.getGraph` | 死代码 | -8 | 无 | 🟢 P3 |
| 删 `BlueprintStore.listGraphs` | 死代码 | -13 | 无 | 🟢 P3 |
| 删 `CapabilityRegistry.recordUsage` | 死代码 | -25 | 无(外部 0 引用) | 🟡 P2 |
| 删 `reorder` 枚举 + 分支 | 死代码 | -3 | 类型更新 | 🟡 P2 |
| `applyHintToBlueprints` 内部化 | 重复抽象 | -5 | API 调整 | 🟡 P2 |
| 修 `TeamOptimizer.estimatedCost` | 技术债 | +5 | 行为变化 | 🔴 P1 |
| `MetaAgent` merge/split 应用 | 技术债 | +30 | 大改 | 🔴 P1(Phase 8) |
| 多 ProposalSource 信号源 | 技术债 | +20 | 测试扩展 | 🟡 P2 |

**P1 (Phase 7 内完成)**:estimatedCost 修复 — 仅 5 行代码,但影响 SimulationEngine 准确性。

**P2 (Phase 7 后续小修)**:删除纯死代码,清理构建。

**P3 (Phase 8 候选)**:MetaAgent merge/split 应用、Plan→TeamGraph 重构、ProposalSource 多源。

---

## 6. 验证步骤

删除后必须跑:

```
pnpm type-check
pnpm --filter @max/meta-system test  (74 tests)
pnpm --filter @max/dags test         (24 tests)
pnpm --filter @max/autonomy test     (37 tests)
pnpm --filter @max/api test          (28 tests)
```

预期:全部通过,无回归。

---

## 7. 附录:Grep 证据汇总

```bash
# 死导出
$ grep -rn "findByCapability" packages apps --include="*.ts" | grep -v test
$ grep -rn "store.getGraph\|store.listGraphs" packages apps --include="*.ts" | grep -v test
$ grep -rn "registry.recordUsage" packages apps --include="*.ts" | grep -v test
$ grep -rn "type: \"reorder\"" packages

# 重复抽象
$ grep -rn "applyHintToBlueprints\|applyHint" packages apps --include="*.ts"

# 信号源多样性
$ grep -rn "source: \"\(failure_pattern_mining\|review_suggestion\|capability_gap\)\"" apps packages --include="*.ts" | grep -v test
apps/api/src/index.ts:466-478  (extractDiscoverySignals — 只产出 user_request_analysis)
```
