# Maximilian 借鉴模块使用情况报告

> 日期: 2026-07-16
> 范围: README.md 中 30 个借鉴模块 + 深度研究对照

---

## 一、统计数据

| 状态               | 数量 | 说明                                                                                                                                     |
| ------------------ | ---- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **✅ 完全 wiring** | 7    | EventBus, StallDetector, DiGraph condition, Tool cache, Tool allowlist/denylist, AgentRegistry, Commander planning                       |
| **🔶 半 wiring**   | 4    | ownedFiles (写但未消费), steering/follow-up hooks (实现但未传参), FailoverReason (imported not exported), Pre-flight validation (未调用) |
| **❌ 死代码**      | ~17  | KnowledgeGraph, HypothesisGenerator, Ensemble, ScholarEval, FailureDetector, MemoryScope, SandboxService, ADR 等                         |

---

## 二、✅ 完全 wiring 模块（保留）

### 2.1 EventBus (Kosmos)

**位置**: `packages/core/src/event-bus.ts`
**调用方**:

- `PhaseRunner` — `phase:start`, `phase:end`, `runner:complete` 事件
- `A2AHandler` — `agent/a2a/received` 事件
  **评价**: 真正运行时的 pub/sub 骨干，刚修复了 publishAsync 问题（Task 2）。建议从 `core/index.ts` 导出以便外部订阅。

### 2.2 StallDetector (AutoGen/Magentic-One)

**位置**: `packages/core/src/stall-detection.ts`
**调用方**: `runtime.ts:932` — 每个 workspace 一个实例，idle/loop/max-rounds 时触发 Commander.replan
**评价**: 长运行 workspace 健康保障核心。

### 2.3 DiGraph condition (AutoGen)

**位置**: `packages/commander/src/index.ts` 写 → `packages/core/src/runtime.ts:1017` 消费
**评价**: substring-match 条件门控，plan 的 task 只有在 prior output 包含 condition 字符串时才执行。生产可用。

### 2.4 Tool result cache (crewAI)

**位置**: `packages/core/src/tool-integration.ts` → `runtime.ts:runToolLoop`
**评价**: 每个工具调用都缓存结果，per-task。

### 2.5 Tool allowlist/denylist (cc-switch)

**位置**: `runtime.ts:1416-1418`
**评价**: 基于 `agent.manifest.allowedTools`/`deniedTools` 动态设置工具权限。

### 2.6 AgentRegistry (Kosmos)

**位置**: `packages/core/src/orchestration/agent-registry.ts`
**调用方**: `A2AHandler` — 刚修复了 routeMessage 投递（Task 1）。
**评价**: ACP A2A 消息路由核心，刚修复为真正投递。

### 2.7 Commander planning (AutoGen)

**位置**: `packages/commander/src/index.ts`
**调用方**: `apps/api/src/index.ts:461` — `new Commander(...)`
**评价**: 需求 → plan 的核心编排器，生产使用。

---

## 三、🔶 半 wiring 模块（1行修复）

### 3.1 Steering/Follow-up messages (openclaw)

**问题**: `tool-integration.ts` 已实现 `getSteeringMessages` 和 `getFollowUpMessages`，但 `runtime.ts:1730` 的 `runToolLoopAndSubmit` 未传入这些 hook。
**修复**: 在 `runtime.ts:1730` 调用处添加 `{ getSteeringMessages, getFollowUpMessages }` 选项。
**评价**: 实现已完成，只需传入选项。

### 3.2 ownedFiles (并行开发)

**问题**: Commander 写入 `metadata.ownedFiles`，`runtime.ts` 从不读取。
**修复**: 在文件写入权限 gate 中检查 `task.metadata.ownedFiles`。
**评价**: 独占文件所有权机制存储了但未执行。

### 3.3 Pre-flight validation

**问题**: `Commander.preflight()` 方法存在，`apps/api` 从不调用。
**修复**: plan 执行前调用 `commander.preflight(plan)`。
**评价**: plan 验证 gate 未接入 API。

### 3.4 FailoverReason/ClassifiedError (hermes-agent)

**问题**: `runtime.ts:18` import 了 `classifyTaskError`，但 enum 和 type 未从 `core/index.ts` 导出。
**修复**: `export enum FailoverReason` 和 `export type ClassifiedError` from `failover-reason.ts`。
**评价**: 错误分类内部使用，不影响功能。

---

## 四、❌ 死代码（删除候选）

### 4.1 ScholarEval × 2 副本

- `packages/core/src/validation/scholar-eval.ts` — 未被引用
- `packages/autonomy/src/validation/scholar-eval.ts` — 未被引用
- **行动**: 删除 core 副本；在 autonomy 副本和 `ReviewIntelligence` 之间二选一接入

### 4.2 FailureDetector (Kosmos)

**位置**: `packages/core/src/validation/failure-detector.ts`
**调用**: 只有 test file `wave1-validation-bus.test.ts`
**行动**: 接入 `SelfCritique` 或 `ReviewIntelligence`，或删除

### 4.3 KnowledgeGraph (Kosmos)

**位置**: `packages/core/src/knowledge/graph.ts`
**调用**: 只有 `wave4-knowledge-ensemble.test.ts`
**行动**: 删除或接入 HypothesisGenerator

### 4.4 ArtifactStateManager (Kosmos)

**位置**: `packages/core/src/world-model/artifacts.ts`
**调用**: 只有 test
**行动**: 删除

### 4.5 MetricsCollector (Kosmos)

**位置**: `packages/core/src/monitoring/metrics.ts`
**注意**: `packages/evolution` 有自己的 `MetricsStore`，不是这个类
**行动**: 删除 core 副本

### 4.6 HypothesisGenerator (Kosmos)

**位置**: `packages/core/src/agents/hypothesis-generator.ts`
**调用**: 只有 test
**行动**: 删除

### 4.7 Ensemble/aggregateFindings (Kosmos)

**位置**: `packages/core/src/workflow/ensemble.ts`
**调用**: 只有 test，`aggregateFindings` 从未被调用
**行动**: 删除

### 4.8 MemoryScope (crewAI)

**位置**: `packages/core/src/memory-scope.ts`
**调用**: 只有 test — "Agent class can compose it" 从未实现
**行动**: 删除

### 4.9 SandboxService (OpenHands)

**位置**: `packages/core/src/sandbox.ts`（4 个实现类）
**问题**: `packages/config/src/schema.ts` 接受 "local"/"docker"/"mac-sandbox-exec"/"process" backend，但没有任何 runtime 实例化它们
**行动**: 删除或接入 runtime 工具执行层

### 4.10 ADR, Pre-flight validation (wshobson)

**位置**: `packages/core/src/adr.ts`
**调用**: 只有 test
**行动**: 删除或接入 commander 流程

### 4.11 其他 wave test fixture

`NullModel`, `PlanReviewer`, `DelegationManager`, `NoveltyDetector`, `SafetyGuardrails`, `ReproducibilityManager`, `RepoMemory`, `PlannerObserver.observeStep` — 均只有 test 引用，删

---

## 五、编译阻塞 Bug

### @max/dags 未导出 Blueprint

`packages/autonomy/src/autonomy-orchestrator.ts:19` 导入 `Blueprint from "@max/dags"`，但 `@max/dags` 未导出该类型。
**状态**: `packages/autonomy` 无法 type-check

---

## 六、README 现实差距

README 声称 30 个借鉴模块，实际：

- **7** 个完全 wiring 生产使用
- **4** 个半 wiring（存储但未消费）
- **~17** 个仅 test fixture（死代码）

**建议**: 更新 README 或删除 ~17 个死代码模块

---

## 七、深度研究对照（Kosmos 原始实现质量）

| 借鉴模块                  | Kosmos 原始                        | Maximilian 现状                 | 评价   |
| ------------------------- | ---------------------------------- | ------------------------------- | ------ |
| EventBus                  | typed pub/sub + async publishAsync | ✅ 已修复 publishAsync          | 达标   |
| ScholarEval 8-dim scoring | Kosmos 8-dim peer-review           | 未接入 ReviewIntelligence       | 待修复 |
| StallDetector             | idle/loop/max-rounds               | ✅ 已 wiring                    | 达标   |
| KnowledgeGraph            | Neo4j in-memory graph              | 只有降级版，从未使用            | 死代码 |
| FailureDetector           | 3 模式检测                         | 从未调用                        | 死代码 |
| Metrics                   | USD budget + alerts                | evolution 用自己的 MetricsStore | 死代码 |

---

## 八、行动建议

### P0（立即）

1. 修复 `@max/dags` Blueprint 导出阻塞编译
2. 删除 ~14 个死代码模块
3. README 同步更新

### P1（本轮）

4. Steering/follow-up hooks 传入 runtime 选项
5. ownedFiles 消费逻辑
6. Pre-flight validation 接入 API

### P2（后续）

7. ScholarEval 副本二选一接入 ReviewIntelligence
8. FailureDetector 接入 SelfCritique
