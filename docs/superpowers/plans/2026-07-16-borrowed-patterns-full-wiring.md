# Borrowed Patterns Full Wiring Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** 删除 ~14 个死代码模块，完成 4 个半 wiring 模块，修编译 bug，更新 README。

---

## Task 0: @max/dags Blueprint 编译修复

**文件**: `packages/dags/src/index.ts`

```bash
grep -n "export" /home/user/shenyaxuan/Maximilian/Maximilian/packages/dags/src/index.ts | head -20
grep -n "Blueprint" /home/user/shenyaxuan/Maximilian/Maximilian/packages/dags/src/*.ts
```

找到 `Blueprint` 的定义位置，添加到 `index.ts` 导出。

---

## Task 1: 删除 ~14 个死代码模块

**确认要删除的模块**:

1. `packages/core/src/validation/scholar-eval.ts` (core 副本)
2. `packages/autonomy/src/validation/scholar-eval.ts` (autonomy 副本，保留 autonomy 版本待接入)
3. `packages/core/src/validation/failure-detector.ts`
4. `packages/core/src/knowledge/graph.ts` (KnowledgeGraph)
5. `packages/core/src/world-model/artifacts.ts` (ArtifactStateManager)
6. `packages/core/src/monitoring/metrics.ts` (MetricsCollector)
7. `packages/core/src/agents/hypothesis-generator.ts`
8. `packages/core/src/workflow/ensemble.ts`
9. `packages/core/src/memory-scope.ts`
10. `packages/core/src/sandbox.ts` (SandboxService，保留 schema 接入点)
11. `packages/core/src/adr.ts`
12. `packages/core/src/orchestration/null-model.ts`
13. `packages/core/src/agents/plan-reviewer.ts`
14. `packages/core/src/orchestration/delegation-manager.ts` (注意：这个文件本身是被借鉴的模块，不是 delegation-manager.ts)
15. `packages/core/src/agents/novelty-detector.ts`
16. `packages/core/src/agents/safety-guardrails.ts`
17. `packages/core/src/agents/reproducibility-manager.ts`

**Step**: 逐个确认文件存在后 git rm 删除，并从 `index.ts` 移除导出。

---

## Task 2: Steering/Follow-up hooks 完整 wiring

**文件**: `packages/core/src/runtime.ts:1730`

在 `runToolLoopAndSubmit` 调用处传入 `getSteeringMessages` 和 `getFollowUpMessages`：

```typescript
// 查找 runToolLoopAndSubmit 调用
grep -n "runToolLoopAndSubmit\|runToolLoop" /home/user/shenyaxuan/Maximilian/Maximilian/packages/core/src/runtime.ts | head -20
```

在调用处添加 hook 选项：

```typescript
runToolLoopAndSubmit(toolProvider, messages, {
  emitEvent,
  workspaceId,
  taskId,
  awaitPermission,
  getSteeringMessages: this.getSteeringMessages.bind(this),
  getFollowUpMessages: this.getFollowUpMessages.bind(this),
})
```

确保 `Runtime` 类有这两个方法：

```typescript
getSteeringMessages(taskId: string): string[] { return [] }
getFollowUpMessages(taskId: string): string[] { return [] }
```

---

## Task 3: ownedFiles 运行时消费

**文件**: `packages/core/src/runtime.ts`

在文件写入工具执行前，检查 `metadata.ownedFiles`：

```typescript
// 在文件写入相关工具的 permission check 中
if (task.metadata?.ownedFiles?.length > 0) {
  const filePath = /* 从 tool call 参数解析 */;
  const owned = task.metadata.ownedFiles as string[];
  const isOwned = owned.some(prefix => filePath.startsWith(prefix));
  if (!isOwned) throw new Error(`File ${filePath} not in ownedFiles: ${owned.join(', ')}`);
}
```

---

## Task 4: Pre-flight validation 接入 API

**文件**: `apps/api/src/index.ts`

找到 Commander 实例化位置，在 `execute()` 之前调用 `preflight()`:

```typescript
// 找到 commander.execute 调用
const preflightResult = await commander.preflight(plan)
if (!preflightResult.valid) {
  return { error: preflightResult.errors }
}
```

确认 `preflight()` 返回结构 `{valid: boolean, errors: string[]}`。

---

## Task 5: FailoverReason/ClassifiedError 导出

**文件**: `packages/core/src/index.ts`

```typescript
export { FailoverReason, ClassifiedError, classifyTaskError } from "./failover-reason.js"
```

---

## Task 6: ScholarEval 接入 ReviewIntelligence

**文件**: `packages/autonomy/src/review-intelligence.ts`

ScholarEval（autonomy 副本）需要实际在 review 流程中调用：

```typescript
import { ScholarEval } from "./validation/scholar-eval.js"

const evalResult = await ScholarEval.evaluate(artifacts, {
  weights: {
    rigor: 0.2,
    novelty: 0.15,
    reproducibility: 0.2,
    clarity: 0.15,
    coherence: 0.1,
    impact: 0.1,
    limitations: 0.05,
    ethics: 0.05,
  },
})
// 将 evalResult 注入到 review 输出
```

确认 ReviewIntelligence 已有 review 方法签名。

---

## Task 7: FailureDetector 接入 SelfCritique

**文件**: `packages/core/src/self-critique.ts`

```typescript
import { FailureDetector } from "./validation/failure-detector.js"

const detector = new FailureDetector()
const flags = detector.check(runResult)
// 如果 flags.has('over_interpretation' | 'invented_metrics' | 'rabbit_hole') → 触发修正
```

---

## Task 8: README 更新

**文件**: `README.md`

将"30 个借鉴模块"改为实际 wiring 数量，移除仅 test 引用的模块列表。

---

## Task 9: 删除剩余 test fixture 文件

确认以下 test 文件仅测死代码模块（如果 test 文件本身测死代码，删除对应的实现后清理 test）：

- `packages/core/test/wave1-validation-bus.test.ts` (测 ScholarEval/FailureDetector)
- `packages/core/test/wave2-validation-delegation.test.ts` (测 NullModel/PlanReviewer/DelegationManager)
- `packages/core/test/wave3-orchestration-safety.test.ts` (测 Safety/Reproducibility)
- `packages/core/test/wave4-knowledge-ensemble.test.ts` (测 KnowledgeGraph/Ensemble/HypothesisGenerator)
- `packages/core/test/memory-scope.test.ts` (测 MemoryScope)
- `packages/core/test/steering-hooks.test.ts` (测 steering hooks)
- `packages/core/test/sandbox-observer.test.ts` (测 SandboxService)
- `packages/core/test/tool-cache.test.ts` (可保留，Tool cache 是 wired)

如果这些 test 对应的实现已删除，删除对应 test 文件。

---

## 执行顺序

1. Task 0 (编译修复)
2. Task 2, 3, 4, 5 (1 行 wiring)
3. Task 6, 7 (ScholarEval/FailureDetector 接入)
4. Task 1 (删除死代码)
5. Task 9 (清理 test)
6. Task 8 (README)
