# Maximilian 项目全面代码修复计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复代码审查中发现的全部 141 个问题（16 Critical, 33 High, 40 Medium, 52 Low）

**Architecture:** 按包分组，优先修复 Critical 和 High 问题，并行执行无依赖的任务，顺序执行有依赖的任务

**Tech Stack:** TypeScript, Node.js, PostgreSQL, Redis

---

## 修复分组概览

| 阶段 | 包                                                                                                            | Critical | High | Medium | Low |
| ---- | ------------------------------------------------------------------------------------------------------------- | -------- | ---- | ------ | --- |
| 1    | providers (retry, router, registry)                                                                           | 2        | 2    | 2      | 3   |
| 2    | database (pg-execution-store, pg-truth-store, pg-pending-proposal-store, provider-config)                     | 1        | 3    | 1      | 0   |
| 3    | commander (index.ts, plan-reviewer)                                                                           | 3        | 3    | 3      | 2   |
| 4    | agents (role-play, review, frontend, backend, roles)                                                          | 2        | 3    | 2      | 3   |
| 5    | autonomy (promotion-engine, candidate-generator, autonomy-orchestrator, execution-store, review-intelligence) | 1        | 3    | 2      | 2   |
| 6    | meta-system (truth-audit, graph-undo, governance)                                                             | 1        | 0    | 2      | 1   |
| 7    | benchmark-core (evaluator, devops-runner, cli)                                                                | 1        | 5    | 2      | 2   |
| 8    | tools (bash, grep, glob, permission, bash-stream)                                                             | 1        | 4    | 1      | 0   |
| 9    | evolution (selector, evolution, metrics-store, secret-scrub)                                                  | 0        | 1    | 1      | 2   |
| 10   | sdk (feature-flags, client)                                                                                   | 0        | 1    | 1      | 1   |
| 11   | llm (formats, router, retry, model-router, options)                                                           | 0        | 3    | 3      | 3   |
| 12   | i18n (index, format)                                                                                          | 0        | 2    | 1      | 3   |
| 13   | dags (dynamic-agent-factory, team-graph-builder, blueprint-store, model-assigner, capability-library)         | 0        | 0    | 5      | 3   |
| 14   | compat-shims (llm, drizzle, hono, version)                                                                    | 0        | 0    | 2      | 4   |
| 15   | queue (resource-lease, index)                                                                                 | 0        | 0    | 1      | 1   |
| 16   | config (feature-flags, index, cascade)                                                                        | 0        | 0    | 2      | 3   |
| 17   | telemetry (collector)                                                                                         | 0        | 0    | 0      | 1   |
| 18   | workspace (atomic)                                                                                            | 0        | 0    | 1      | 0   |

---

## 阶段 1: Providers 包 (Critical + High 修复)

### Task 1.1: 修复 withRetry 包装 stream 和 embeddings

**Files:**

- Modify: `packages/providers/src/retry.ts:53-61`

**Steps:**

- [ ] **Step 1: 读取当前实现**

```typescript
// 查看当前的 retry 包装逻辑
export function withRetry<T extends Provider>(
  provider: T,
  options: RetryOptions = {},
): T & RetryWrapper {
  // ... 现有代码
  return {
    get id() {
      return provider.id
    },
    get name() {
      return provider.name
    },
    get defaultModel() {
      return provider.defaultModel
    },
    chat: retryChat,
    stream: provider.stream.bind(provider), // ❌ 未包装
    embeddings: provider.embeddings?.bind(provider), // ❌ 未包装
    isConfigured: provider.isConfigured.bind(provider),
  }
}
```

- [ ] **Step 2: 添加 stream 包装函数**

```typescript
const retryStream = async function* (
  this: Provider,
  messages: ChatMessage[],
  options?: ChatOptions,
): AsyncIterable<ChatChunk> {
  let attempt = 0
  while (true) {
    try {
      yield* provider.stream(messages, options)
      return
    } catch (err) {
      attempt++
      if (!isRetryable(err) || attempt > maxAttempts) throw err
      await sleep(computeBackoff(attempt, baseDelay, jitter))
    }
  }
}
```

- [ ] **Step 3: 添加 embeddings 包装函数**

```typescript
const retryEmbeddings = async (
  this: Provider,
  input: string | string[],
  options?: EmbedOptions,
): Promise<EmbedResult> => {
  let attempt = 0
  while (true) {
    try {
      return await (provider.embeddings?.call(provider, input, options) ??
        provider.embeddings!(input, options))
    } catch (err) {
      attempt++
      if (!isRetryable(err) || attempt > maxAttempts) throw err
      await sleep(computeBackoff(attempt, baseDelay, jitter))
    }
  }
}
```

- [ ] **Step 4: 更新返回对象**

```typescript
return {
  get id() {
    return provider.id
  },
  get name() {
    return provider.name
  },
  get defaultModel() {
    return provider.defaultModel
  },
  chat: retryChat,
  stream: retryStream.bind(provider), // ✅ 已包装
  embeddings: provider.embeddings ? retryEmbeddings.bind(provider) : undefined, // ✅ 已包装
  isConfigured: provider.isConfigured.bind(provider),
}
```

- [ ] **Step 5: 验证修改**

Run: `cd packages/providers && npx tsc --noEmit`
Expected: 无编译错误

---

### Task 1.2: 修复 ProviderRouter.stream 绕过包装器

**Files:**

- Modify: `packages/providers/src/router.ts:81-88`

**Steps:**

- [ ] **Step 1: 读取当前 stream 实现**

```typescript
async *stream(
  messages: ChatMessage[],
  options?: ChatOptions,
): AsyncIterable<ChatChunk> {
  const provider = this.selectProvider();
  const wrapped = this.wrappedProviders.get(provider.id) ?? provider;
  yield* wrapped.stream(messages, options);  // ❌ 直接使用 provider
}
```

- [ ] **Step 2: 改为使用 route 模式**

```typescript
async *stream(
  messages: ChatMessage[],
  options?: ChatOptions,
): AsyncIterable<ChatChunk> {
  yield* this.route(p => p.stream(messages, options));
}
```

- [ ] **Step 3: 添加 route 方法支持流式**

查看 `chat` 的 route 实现，然后在 `route` 方法中添加对 `stream` 的支持

---

### Task 1.3: 修复 ProviderRouter 构造函数存储原始 provider

**Files:**

- Modify: `packages/providers/src/router.ts:40-60`

**Steps:**

- [ ] **Step 1: 检查构造函数中 wrappedProviders 的赋值**

```typescript
constructor(config: RouterConfig) {
  for (const [id, provider] of Object.entries(config.providers)) {
    const wrapped = this.wrapProvider(provider);
    this.providers.set(id, wrapped);
    this.wrappedProviders.set(id, wrapped);  // ✅ 存储包装后的
  }
}
```

---

### Task 1.4: 修复 createRegistry 所有 provider 失败时静默成功

**Files:**

- Modify: `packages/providers/src/registry.ts:72-104`

**Steps:**

- [ ] **Step 1: 添加验证检查**

```typescript
// 在设置 currentDefaultId 之后添加
if (resilient.length === 0) {
  throw new Error(
    `[ProviderRegistry] No providers initialized successfully. ` +
      `Tried presets: ${Object.keys(presets).join(", ")}. ` +
      `Check API keys and network connectivity.`,
  )
}
```

---

## 阶段 2: Database 包

### Task 2.1: 修复 pg-execution-store archiveOlderThan 竞态条件

**Files:**

- Modify: `packages/database/src/stores/pg-execution-store.ts:159-198`

**Steps:**

- [ ] **Step 1: 读取当前实现**

```typescript
const rows = await this.db
  .select()
  .from(executions)
  .where(and(lt(executions.startedAt, cutoff), isNull(executions.archivedAt)))
// ← 竞态窗口
await this.db.insert(executionsArchive).values(rows.map(...)).onConflictDoNothing()
await this.db
  .delete(executions)
  .where(and(lt(executions.startedAt, cutoff), isNull(executions.archivedAt)))
```

- [ ] **Step 2: 改为原子 DELETE...RETURNING**

```typescript
// 使用单个原子 DELETE 语句，先存档后删除
await this.db.transaction(async (tx) => {
  // 1. 选中要删除的行
  const rows = await tx
    .select()
    .from(executions)
    .where(and(lt(executions.startedAt, cutoff), isNull(executions.archivedAt)))

  if (rows.length === 0) return

  // 2. 插入存档（使用 RETURNING 的 id）
  await tx
    .insert(executionsArchive)
    .values(rows.map((row) => ({ ...row, archivedAt: new Date().toISOString() })))
    .onConflictDoNothing()

  // 3. 使用 IN 子句删除确切选中的行（基于 id）
  const ids = rows.map((r) => r.id)
  await tx.delete(executions).where(inArray(executions.id, ids))
})
```

---

### Task 2.2: 修复 pg-truth-store saveMeasurement 丢失 predicted 字段

**Files:**

- Modify: `packages/database/src/stores/pg-truth-store.ts:77-96`

**Steps:**

- [ ] **Step 1: 添加 predicted 到 onConflictDoUpdate.set**

```typescript
.onConflictDoUpdate({
  target: truthMeasurements.id,
  set: {
    actual: m.actual,
    predicted: m.predicted,        // ✅ 添加此行
    sampleSize: m.sampleSize,
    updatedAt: new Date().toISOString(),
  },
})
```

---

### Task 2.3: 修复 pg-pending-proposal-store resolve 无验证

**Files:**

- Modify: `packages/database/src/stores/pg-pending-proposal-store.ts:67-82`

**Steps:**

- [ ] **Step 1: 添加 action 参数验证**

```typescript
async resolve(
  proposalId: string,
  action: "approved" | "rejected",
  resolvedBy: string,
  reason: string,
): Promise<void> {
  // ✅ 添加验证
  if (action !== "approved" && action !== "rejected") {
    throw new Error(`Invalid action: ${action}. Must be "approved" or "rejected".`);
  }

  await this.db
    .update(pendingProposals)
    .set({
      status: action,
      resolvedAt: new Date().toISOString(),
      resolvedBy,
      resolutionReason: reason,
    })
    .where(eq(pendingProposals.proposalId, proposalId));
}
```

---

### Task 2.4: 修复 provider-config 允许插入任意 providerId

**Files:**

- Modify: `packages/database/src/provider-config.ts:49-63`

**Steps:**

- [ ] **Step 1: 添加 providerId 存在性验证**

```typescript
import { PROVIDER_PRESETS } from "@max/providers"

// 在 setDefaultProviderInDb 中
async function setDefaultProviderInDb(providerId: string, defaultModel?: string): Promise<void> {
  // ✅ 验证 providerId 存在
  const knownIds = Object.keys(PROVIDER_PRESETS)
  if (!knownIds.includes(providerId)) {
    throw new Error(`Unknown providerId: ${providerId}. Known providers: ${knownIds.join(", ")}`)
  }

  await this.db.transaction(async (tx) => {
    // ... 现有逻辑
  })
}
```

---

## 阶段 3: Commander 包

### Task 3.1: 修复 JSON 提取贪婪正则

**Files:**

- Modify: `packages/commander/src/index.ts:540`

**Steps:**

- [ ] **Step 1: 改为非贪婪匹配或括号平衡**

```typescript
// 方案1: 非贪婪匹配（简单但有局限）
const match = text.match(/\{[\s\S]*?\}/)

// 方案2: 正确平衡括号（推荐）
function extractBalancedBraces(text: string): string | null {
  let depth = 0
  let start = -1

  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") {
      if (depth === 0) start = i
      depth++
    } else if (text[i] === "}") {
      depth--
      if (depth === 0) {
        return text.slice(start, i + 1)
      }
    }
  }
  return null
}

// 使用
const jsonStr = extractBalancedBraces(text)
if (jsonStr) {
  try {
    return JSON.parse(jsonStr)
  } catch {
    // 回退到默认计划
  }
}
```

---

### Task 3.2: 修复 Review 任务 dependsOn 引用错误

**Files:**

- Modify: `packages/commander/src/index.ts:369-371`

**Steps:**

- [ ] **Step 1: 使用正确的 task ID 和依赖关系**

```typescript
// 方案: 直接使用 parsed.tasks 中每个 task 指定的 ID 和依赖
const taskIds = parsed.tasks.map((t) => t.id)
const reviewTasks = parsed.tasks.map((task, idx) => ({
  id: task.id,
  dependsOn: (task.dependsOn || [])
    .map((depId) => {
      // 验证依赖 ID 存在
      const depIdx = taskIds.indexOf(depId)
      return depIdx >= 0 ? `task-${depIdx + 1}` : null
    })
    .filter(Boolean),
  // ...
}))

// 如果 task 没有指定依赖，且不是第一个任务，则依赖前一个任务
if (reviewTasks[0] && reviewTasks[0].dependsOn.length === 0) {
  // 第一个任务不需要依赖
}
```

---

### Task 3.3: 修复 replan 生成 NaN Task ID

**Files:**

- Modify: `packages/commander/src/index.ts:437-446`

**Steps:**

- [ ] **Step 1: 添加安全的默认值**

```typescript
const startIdx = remainingTasks[0]?.id.match(/task-(\d+)/)?.[1]
const offset = startIdx ? Number(startIdx) - 1 : 0

// ✅ 添加 NaN 检查
if (Number.isNaN(offset)) {
  // 使用默认起始索引 1
  startIdx = "1"
}
```

---

### Task 3.4: 修复 countTaskTypes 始终返回 1

**Files:**

- Modify: `packages/commander/src/plan-reviewer.ts:54-56`

**Steps:**

- [ ] **Step 1: 使用正确的字段名**

```typescript
function countTaskTypes(tasks: Array<{ agentRole?: string }>): number {
  const types = new Set(tasks.map((t) => t.agentRole ?? "default"))
  return types.size
}
```

---

### Task 3.5: 修复 preflight 未验证 tasks 是 Array

**Files:**

- Modify: `packages/commander/src/index.ts:301`

**Steps:**

- [ ] **Step 1: 添加 Array.isArray 检查**

```typescript
if (!plan.tasks || !Array.isArray(plan.tasks) || plan.tasks.length === 0) {
  return { valid: false, errors: ["plan.tasks must be a non-empty array"] }
}
```

---

### Task 3.6: 修复 userRequest 注入 LLM prompt

**Files:**

- Modify: `packages/commander/src/index.ts:346, 421`

**Steps:**

- [ ] **Step 1: 添加 prompt 消毒函数**

```typescript
function sanitizeForPrompt(str: string): string {
  // 移除或转义可能干扰 prompt 的模式
  return str
    .replace(/�/g, '')  // 移除 null 字符
    .replace(/\{[\s\S]*?\}/g, '(content removed)')  // 移除潜在 JSON 注入
    .slice(0, 10000);  // 限制长度
}

const userMessage = `Original user request: ${sanitizeForPrompt(userRequest)}\n\n` + ...
```

---

### Task 3.7: 修复 LLM 调用无超时

**Files:**

- Modify: `packages/commander/src/index.ts:348`

**Steps:**

- [ ] **Step 1: 添加超时机制**

```typescript
const TIMEOUT_MS = 120_000; // 2 分钟

const response = await Promise.race([
  provider.chat(messages, { ... }),
  new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('LLM call timeout after 120s')), TIMEOUT_MS)
  ),
]);
```

---

## 阶段 4: Agents 包

### Task 4.1: 修复 estimateConsensusScore 忽略 A 输出

**Files:**

- Modify: `packages/agents/src/role-play.ts:249`

**Steps:**

- [ ] **Step 1: 实现双端评估**

```typescript
private estimateConsensusScore(aOutput: string, bFeedback: string): number {
  // ✅ 分析 A 的输出质量
  const aHasContent = aOutput.trim().length > 0;
  const aSeemsReasonable = !/(I don't know|unable|cannot|error)/i.test(aOutput);

  // 分析 B 的反馈
  const bApproved = /\b(approved|looks good|sounds right|acceptable)\b/i.test(bFeedback);
  const bRejected = /\b(rejected|needs work|problems?|issues?|incorrect)\b/i.test(bFeedback);
  const bUncertain = /\b(maybe|not sure|unclear|could|would)\b/i.test(bFeedback);

  // 综合评分
  if (bApproved && aSeemsReasonable) return 0.9;
  if (bRejected) return 0.1;
  if (bUncertain) return 0.4;
  if (aHasContent && aSeemsReasonable) return 0.6;
  return 0.3;
}
```

---

### Task 4.2: 修复 ReviewResult 必需字段为空

**Files:**

- Modify: `packages/agents/src/review.ts:83-94`

**Steps:**

- [ ] **Step 1: 从上下文获取真实值**

```typescript
const review: ReviewResult = {
  id: randomUUID(),
  workspaceId: context.workspaceId ?? "unknown", // ✅ 从 context 获取
  planId: context.planId ?? "unknown", // ✅ 从 context 获取
  reviewerRole: "reviewer",
  score: 0,
  issues: [],
  approved: false,
  createdAt: new Date().toISOString(),
}
```

---

### Task 4.3: 修复 agentFactory 类型不匹配

**Files:**

- Modify: `packages/agents/src/role-play.ts:82-83`

**Steps:**

- [ ] **Step 1: 明确类型转换**

```typescript
import { AgentRole } from "./types"

// 在调用处
this.agentA = agentFactory(opts.roleA as AgentRole, opts.roleAPreferredProvider)
this.agentB = agentFactory(opts.roleB as AgentRole, opts.roleBPreferredProvider)
```

---

### Task 4.4: 修复 durationMs 始终 undefined

**Files:**

- Modify: `packages/agents/src/frontend.ts:69`, `packages/agents/src/backend.ts:59`, `packages/agents/src/review.ts:103`

**Steps:**

- [ ] **Step 1: 添加时间测量**

```typescript
async execute(context: AgentContext): Promise<AgentResult> {
  const startTime = Date.now();  // ✅ 开始计时
  try {
    // ... 现有逻辑
    return {
      ok: true,
      outputs,
      durationMs: Date.now() - startTime,  // ✅ 返回实际耗时
    };
  } catch (err) {
    return {
      ok: false,
      error: (err as Error).message,
      durationMs: Date.now() - startTime,  // ✅ 即使失败也记录
    };
  }
}
```

---

### Task 4.5: 修复 _history 数组无限增长

**Files:**

- Modify: `packages/agents/src/role-play.ts:64`, `packages/agents/src/phase.ts:150`

**Steps:**

- [ ] **Step 1: 添加大小限制**

```typescript
private readonly _history: RolePlayMessage[] = [];
private static readonly MAX_HISTORY_SIZE = 1000;  // ✅ 添加限制

private addToHistory(msg: RolePlayMessage): void {
  this._history.push(msg);
  // ✅ 超过限制时移除最老的记录
  if (this._history.length > RolePlay.MAX_HISTORY_SIZE) {
    this._history.shift();
  }
}
```

---

## 阶段 5: Autonomy 包

### Task 5.1: 修复 promotion-engine 并发竞态条件

**Files:**

- Modify: `packages/autonomy/src/promotion-engine.ts:66-73`

**Steps:**

- [ ] **Step 1: 使用文件锁**

```typescript
import { mkdirSync } from 'fs';

// 简单文件锁实现
const locks = new Map<string, Promise<void>>();

async function withLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  // 等待现有锁
  while (locks.has(filePath)) {
    await locks.get(filePath);
  }

  const lockFile = filePath + '.lock';
  locks.set(filePath, (async () => {
    mkdirSync(lockFile, { recursive: true });
  })());

  try {
    return await fn();
  } finally {
    locks.delete(filePath);
    try {
      rmSync(lockFile);
    } catch { /* ignore */ }
  }
}

async appendHistory(record: PromotionRecord): Promise<void> {
  await withLock(this.historyFile(), async () => {
    // 重新读取最新状态（其他进程可能已修改）
    const raw = await fs.readFile(this.historyFile(), 'utf-8');
    const history = JSON.parse(raw || '[]');
    history.push(record);
    await fs.writeFile(this.historyFile(), JSON.stringify(history, null, 2), 'utf-8');
  });
}
```

---

### Task 5.2: 修复 candidate-generator 丢弃非 systemPrompt 变更

**Files:**

- Modify: `packages/autonomy/src/candidate-generator.ts:119-127`

**Steps:**

- [ ] **Step 1: 添加警告日志**

```typescript
function applyChanges(basePrompt: string, changes: PlanChange[]): string {
  let result = basePrompt
  for (const c of changes) {
    switch (c.type) {
      case "systemPrompt":
        if (c.to) {
          result = c.to
        }
        break
      case "tools":
      case "constraints":
      case "preferredModels":
        // ✅ 添加警告（而不是静默丢弃）
        console.warn(
          `[CandidateGenerator] PlanChange type '${c.type}' is not yet supported. ` +
            `Only 'systemPrompt' changes are currently implemented.`,
        )
        break
    }
  }
  return result
}
```

---

### Task 5.3: 修复 blueprintCache 无限增长

**Files:**

- Modify: `packages/autonomy/src/autonomy-orchestrator.ts:69-75`

**Steps:**

- [ ] **Step 1: 添加 LRU 缓存**

```typescript
const blueprintCache = new Map<string, Blueprint>();
private static readonly MAX_CACHE_SIZE = 100;  // ✅ 添加限制

function setBlueprint(role: string, bp: Blueprint): void {
  if (blueprintCache.size >= AutonomyOrchestrator.MAX_CACHE_SIZE) {
    // ✅ 移除最老的条目
    const firstKey = blueprintCache.keys().next().value;
    blueprintCache.delete(firstKey);
  }
  blueprintCache.set(role, bp);
}
```

---

### Task 5.4: 修复 execution-store 租户隔离

**Files:**

- Modify: `packages/autonomy/src/execution-store.ts:38`

**Steps:**

- [ ] **Step 1: 修正隔离逻辑**

```typescript
// ❌ 原有逻辑: tenantId: undefined 对所有租户可见
// return tenantId ? all.filter((r) => !r.tenantId || r.tenantId === tenantId) : all

// ✅ 修正: tenantId: undefined 只对 undefined 租户可见
return tenantId
  ? all.filter((r) => r.tenantId === tenantId) // 严格匹配
  : all.filter((r) => r.tenantId === undefined) // 只有真正未设置租户的
```

---

### Task 5.5: 修复 candidate-generator ID 路径遍历

**Files:**

- Modify: `packages/autonomy/src/candidate-generator.ts:62`

**Steps:**

- [ ] **Step 1: 添加路径验证**

```typescript
import { isWithinDirectory } from 'path';

private fileFor(id: string): string {
  // ✅ 验证 ID 不包含路径遍历
  if (id.includes('..') || id.includes('/') || id.includes('\\')) {
    throw new Error(`Invalid candidate ID '${id}': path traversal detected`);
  }

  const baseDir = this.dir();
  const filePath = path.join(baseDir, `${id}.json`);

  // ✅ 确保最终路径在 baseDir 内
  if (!isWithinDirectory(path.dirname(filePath), baseDir)) {
    throw new Error(`Invalid candidate ID '${id}': path traversal detected`);
  }

  return filePath;
}
```

---

## 阶段 6: Meta-system 包

### Task 6.1: 修复 TruthAudit 未处理 Promise rejection

**Files:**

- Modify: `packages/meta-system/src/truth-audit.ts:91-97, 169`

**Steps:**

- [ ] **Step 1: 保存 Promise 引用**

```typescript
if (this.deps.saveMeasurement) {
  void this.deps.saveMeasurement(m).catch((err) => {
    // ✅ 使用 void
    console.warn(`[TruthAudit] saveMeasurement failed: ${(err as Error).message}`)
  })
}
```

---

### Task 6.2: 修复 graph-undo redo-invalidation 非原子

**Files:**

- Modify: `packages/meta-system/src/graph-undo.ts:141-151`

**Steps:**

- [ ] **Step 1: 改变操作顺序**

```typescript
push(delta: GraphDelta): void {
  // ✅ 先清空 redo，再添加新条目
  this.redoStack.length = 0;  // 清空 redo

  const entry: UndoEntry = {
    delta,
    inverse: reverseDelta(delta),
  };
  this.entries.push(entry);

  // 限制大小
  if (this.entries.length > this.maxSize) {
    this.entries.shift();
  }
}
```

---

### Task 6.3: 修复 GovernanceEngine maxDepth 线性搜索

**Files:**

- Modify: `packages/meta-system/src/governance.ts:136-163`

**Steps:**

- [ ] **Step 1: 构建 Map 缓存**

```typescript
function maxDepth(g: GovernanceGraph, id: string): number {
  // ✅ 构建节点查找 Map
  const nodeMap = new Map(g.nodes.map((n) => [n.id, n]))

  function depth(nodeId: string, visited: Set<string>): number {
    const node = nodeMap.get(nodeId)
    if (!node) return 0
    if (visited.has(nodeId)) return 0 // 防止循环

    visited.add(nodeId)

    if (!node.edges || node.edges.length === 0) {
      return 1
    }

    let maxChildDepth = 0
    for (const edge of node.edges) {
      maxChildDepth = Math.max(maxChildDepth, depth(edge.target, new Set(visited)))
    }

    return 1 + maxChildDepth
  }

  return depth(id, new Set())
}
```

---

## 阶段 7: Benchmark-core 包

### Task 7.1: 修复 evaluator 错误被覆盖

**Files:**

- Modify: `packages/benchmark-core/src/evaluator.ts:121`

**Steps:**

- [ ] **Step 1: 修正条件**

```typescript
error: domainResult.error ?? (!assertionPassed ? "assertion failed" : undefined),
// ✅ 改为: assertionPassed 为 false 时才显示 "assertion failed"
```

---

### Task 7.2: 修复 devops-runner 命令注入

**Files:**

- Modify: `packages/benchmark-core/src/runners/devops-runner.ts:57`

**Steps:**

- [ ] **Step 1: 添加输入验证和沙箱**

```typescript
// 验证脚本内容
function validateScript(script: string): void {
  const dangerous = [
    /\brm\s+-rf\b/i,
    /\bmkfs\b/,
    /\bdd\b.*of=\//,
    /\bcurl\b.*\|\s*sh/i,
    /\bwget\b.*\|\s*sh/i,
  ]

  for (const pattern of dangerous) {
    if (pattern.test(script)) {
      throw new Error(`Potentially dangerous command detected in script`)
    }
  }
}

output = execSync(script, {
  cwd: sandboxDir,
  timeout: 10_000,
  shell: "/bin/bash",
  // ✅ 添加环境限制
  env: {
    ...process.env,
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin", // 限制 PATH
  },
})
```

---

### Task 7.3: 修复 devops-runner 路径遍历

**Files:**

- Modify: `packages/benchmark-core/src/runners/devops-runner.ts:130`

**Steps:**

- [ ] **Step 1: 验证路径**

```typescript
function safeJoin(base: string, target: string): string {
  const joined = path.join(base, target)
  if (!joined.startsWith(base + path.sep) && joined !== base) {
    throw new Error(`Path traversal attempt detected: ${target}`)
  }
  return joined
}
```

---

### Task 7.4: 修复 devops-runner 正则 DoS

**Files:**

- Modify: `packages/benchmark-core/src/runners/devops-runner.ts:144-150`

**Steps:**

- [ ] **Step 1: 添加超时保护**

```typescript
import { performance } from "perf_hooks"

function testWithTimeout(pattern: string, input: string, timeoutMs = 1000): boolean {
  const start = performance.now()
  try {
    const regex = new RegExp(pattern, "m")
    const result = regex.test(input)
    if (performance.now() - start > timeoutMs) {
      throw new Error("Regex timeout")
    }
    return result
  } catch (e) {
    if ((e as Error).message === "Regex timeout") {
      throw new Error("Regex evaluation exceeded timeout")
    }
    throw e
  }
}
```

---

### Task 7.5: 修复 cli.ts 路径遍历

**Files:**

- Modify: `packages/benchmark-core/src/cli.ts:97`

**Steps:**

- [ ] **Step 1: 验证 domain 参数**

```typescript
function safeImport(domain: string): Promise<any> {
  // 允许的字符
  if (!/^[a-z0-9_-]+$/i.test(domain)) {
    throw new Error(`Invalid domain name: ${domain}`)
  }

  const mod = await import(`../../../benchmarks/${domain}/tasks.js`)
  return mod
}
```

---

## 阶段 8: Tools 包

### Task 8.1: 修复 bash.ts workdir 未验证

**Files:**

- Modify: `packages/tools/src/bash.ts:70-80`

**Steps:**

- [ ] **Step 1: 添加目录验证**

```typescript
const ALLOWED_DIRECTORIES = [process.cwd(), path.join(process.cwd(), "workspace"), "/tmp"]

function validateWorkdir(cwd: string): string {
  const resolved = path.resolve(cwd)
  for (const allowed of ALLOWED_DIRECTORIES) {
    if (resolved.startsWith(path.resolve(allowed))) {
      return resolved
    }
  }
  throw new Error(`Workdir '${cwd}' is not in allowed directories`)
}

const cwd = validateWorkdir(input.workdir ?? process.cwd())
```

---

### Task 8.2: 修复 grep.ts 和 glob.ts 隐藏目录遍历

**Files:**

- Modify: `packages/tools/src/grep.ts:44-69`, `packages/tools/src/glob.ts:40-45`

**Steps:**

- [ ] **Step 1: 添加隐藏目录黑名单**

```typescript
const HIDDEN_DIR_BLACKLIST = [
  ".ssh",
  ".aws",
  ".config",
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
]

function isBlacklistedDir(name: string): boolean {
  return HIDDEN_DIR_BLACKLIST.includes(name) || name.startsWith(".")
}

if (entry.isDirectory()) {
  if (
    !entry.name.startsWith(".") &&
    entry.name !== "node_modules" &&
    !isBlacklistedDir(entry.name)
  ) {
    stack.push(fullPath)
  }
}
```

---

### Task 8.3: 修复 permission.ts bash 命令检测

**Files:**

- Modify: `packages/tools/src/permission.ts:145-170`

**Steps:**

- [ ] **Step 1: 添加危险命令检测**

```typescript
const DANGEROUS_PATTERNS = [
  /^rm\s+-rf/i,
  /^dd\s+/i,
  /^mkfs/i,
  /^curl\s+.*\|\s*sh/i,
  /^wget\s+.*\|\s*sh/i,
  /^nc\s+-e/i,
  /^bash\s+-i/i,
  /^python\s+-c\s+import\s+os/i,
]

function validateBashCommand(command: string): boolean {
  const normalized = command.trim().split("\n")[0] // 只检查第一行
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(normalized)) {
      return false // 拒绝
    }
  }
  return true
}
```

---

### Task 8.4: 修复 bash-stream.ts 错误处理

**Files:**

- Modify: `packages/tools/src/bash-stream.ts:160-164`

**Steps:**

- [ ] **Step 1: 添加错误处理改进**

```typescript
const exitCode = await new Promise<number>((resolve) => {
  child.on("close", (code) => resolve(code ?? 1))
  child.on("error", (err) => {
    console.error(`[bash-stream] process error: ${err.message}`)
    resolve(1)
  })
  child.stdin?.on("error", (err) => {
    console.error(`[bash-stream] stdin error: ${err.message}`)
  })
})
```

---

## 阶段 9: Evolution 包

### Task 9.1: 修复 nextVersionId 非标准版本

**Files:**

- Modify: `packages/evolution/src/evolution.ts:349-356`

**Steps:**

- [ ] **Step 1: 添加验证和回退**

```typescript
function nextVersionId(versions: string[]): string {
  const nums = versions
    .map((v) => /^v(\d+)$/.exec(v)?.[1])
    .filter((x): x is string => !!x)
    .map((x) => parseInt(x, 10))

  if (nums.length === 0) {
    // 没有标准版本，从 v1 开始
    return "v1"
  }

  const max = Math.max(...nums)
  return `v${max + 1}`
}
```

---

## 阶段 10: SDK 包

### Task 10.1: 修复 feature-flags 缓存忽略 userId

**Files:**

- Modify: `packages/sdk/src/feature-flags.ts:37, 48-49`

**Steps:**

- [ ] **Step 1: 在缓存 key 中包含 userId**

```typescript
private readonly cache = new Map<string, CacheEntry>();

private cacheKey(name: string): string {
  return `${name}:${this.userId ?? ''}`;  // ✅ 包含 userId
}

async isEnabled(name: string): Promise<boolean> {
  const cached = this.cache.get(this.cacheKey(name));  // ✅ 使用新方法
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  // ... fetch
  this.cacheMiss(this.cacheKey(name), data.enabled);  // ✅ 使用新方法
}
```

---

## 阶段 11: LLM 包

### Task 11.1: 修复 AbortSignal 未转发

**Files:**

- Modify: `packages/llm/src/formats/anthropic.ts`, `packages/llm/src/formats/openai-chat.ts`, `packages/llm/src/formats/gemini-native.ts`

**Steps:**

- [ ] **Step 1: 在 fetch 调用中转发 signal**

```typescript
// 在 streaming fetch 中
const response = await fetch(url, {
  method: "POST",
  headers,
  body: bodyStr,
  signal: options.signal, // ✅ 添加此行
})
```

---

### Task 11.2: 修复 Router.stream 绕过 retry

**Files:**

- Modify: `packages/llm/src/router.ts:84-88`

**Steps:**

- [ ] **Step 1: 使用 route 方法**

```typescript
async *stream(
  messages: ChatMessage[],
  options?: ChatOptions,
): AsyncIterable<ChatChunk> {
  yield* this.route(p => p.stream(messages, options));
}
```

---

## 阶段 12: i18n 包

### Task 12.1: 修复 ts() 和 tn() 回退参数丢失

**Files:**

- Modify: `packages/i18n/src/index.ts:302, 276`

**Steps:**

- [ ] **Step 1: 修正回退逻辑**

```typescript
// ts() 中的问题
return t(`${key}.${options.fallback}`, params, t(key)) // ✅ 传递 params

// tn() 中的问题
return t(key, params) // ✅ 确保 params 被传递
```

---

## 阶段 13: Dags 包

### Task 13.1: 修复 stats.totalSuccesses 和 avgScore 从未更新

**Files:**

- Modify: `packages/dags/src/dynamic-agent-factory.ts:133-166`

**Steps:**

- [ ] **Step 1: 在 persistStats 中更新这些字段**

```typescript
async persistStats(): Promise<void> {
  const stats = this.stats;
  // ✅ 添加更新逻辑
  stats.totalSuccesses = (stats.totalSuccesses ?? 0) + (this.lastResult?.ok ? 1 : 0);
  if (this.lastResult?.score !== undefined) {
    const n = stats.totalRuns ?? 0;
    const currentAvg = stats.avgScore ?? 0;
    stats.avgScore = (currentAvg * n + this.lastResult.score) / (n + 1);
  }
  stats.totalRuns = (stats.totalRuns ?? 0) + 1;

  await this.store.saveBlueprint(this.blueprintId, { stats });
}
```

---

## 阶段 14-18: 其他包的低优先级修复

这些修复相对简单，按需执行。

---

## 执行检查清单

每个阶段完成后，验证：

- [ ] `cd packages/[package] && npx tsc --noEmit` 无错误
- [ ] 相关测试通过（如果存在）
- [ ] 代码逻辑符合预期

---

## 依赖关系图

```
阶段1 (providers)     ──────────────────→ 阶段3 (commander 依赖 providers)
     │
     └───────────────────────────────────→ 阶段11 (llm 依赖 providers 的修复)

阶段2 (database)      ──────────────────→ 阶段5 (autonomy 依赖 database)

阶段3 (commander)     ──────────────────→ 阶段4 (agents 某些依赖 commander)

阶段7 (benchmark)     ──────────────────→ 阶段8 (tools 被 benchmark 使用)

其他阶段可并行执行
```

---

**Plan created:** 2026-07-20
**Total tasks:** 40+
**Estimated time:** 8-16 小时（并行执行可加速）
