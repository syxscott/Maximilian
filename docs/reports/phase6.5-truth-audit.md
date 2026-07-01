# Phase 6.5 — Truth Audit（现实一致性审计）

**Date**: 2026-06-22
**Type**: Code-base reality check, not design-doc check
**Question**: 这个系统是否真的"自进化"，还是只是"自描述"？

---

## 0. 一句话答案

> **这是一个"自描述"系统，不是"自进化"系统。**
>
> Phase 4 的 model selection 和 memory injection 是 **TRUE CORE**；Phase 5 的 evolution plans/candidates 是 **SHADOW**；Phase 6 的整个 meta-system 是 **SHADOW**（写 JSON 日志，不影响任何 runtime 决策路径）。

---

## 1. /api/chat 的真实调用链（runtime trace）

### 1.1 入口分流

```
POST /api/chat  (apps/api/src/routes/chat.ts:25)
        │
        ▼
ChatRequestSchema.parse(body)            ← 仅校验
        │
        ▼
if (dagsMode && dags && orchestrator) {  ← DAGS_MODE=true 才走此路径
        ▼
    buildDagsWorkspace(dags, message)    ← dags-flow.ts:35
        │  ├─ dags.compose(userRequest)  ← packages/dags/src/dags.ts:67
        │  │   ├─ analyzer.analyze()    ← CapabilityLibrary 静态匹配
        │  │   ├─ generator.generate()   ← BlueprintStore（独立）
        │  │   ├─ graphBuilder.build()
        │  │   └─ assigner.assign()     ← facade.selectForRole(role)
        │  │                              ★ TRUE: 用 leaderboard 选 model
        │  └─ map graph.nodes → tasks
        ▼
    saveWorkspace(workspace)
        ▼
    runDagsFlow(...)                      ← dags-flow.ts:93
        ├─ dags.buildAgentFactory(composed)
        ├─ new AgentRuntime(factory, sink).execute(workspace)
        ├─ saveWorkspace(final)
        └─ orchestrator.observe(final)    ← AutonomyOrchestrator (Phase 5)
                                            │
                                            ▼
                                       observe() 写入 ExecutionStore
                                       触发 review + planner + 候选生成
                                       ★ Phase 5 是 SHADOW（见 §5）
        │
        ▼
    return { workspaceId, mode: "dags" }
}
```

### 1.2 Meta-system 在调用链中的位置

```
apps/api/src/index.ts:198
  let metaOrchestrator: MetaOrchestrator | undefined;

apps/api/src/index.ts:374
  if (metaOrchestrator && metaGovernance && ...) {
    // 把路由挂到 /api/meta/*
  }

apps/api/src/routes/meta.ts:116
  const result = await orchestrator.cycle(input);   ← 唯一调用点
```

**MetaOrchestrator.cycle() 在整个 monorepo 内只被调用一次：`POST /api/meta/cycle` HTTP handler。**

`/api/chat` 不调用它。`AutonomyOrchestrator.observe()` 不调用它。DAGS 不调用它。Runtime listener 不调用它。

**没有任何路径在用户请求到达时自动触发 cycle。**

---

## 2. Meta-Agent 是否真的在"改变系统结构"？

### 2.1 Birth — 实际影响

```typescript
// apps/api/src/index.ts:207
const birth = new AgentBirthEngine({ rootDir: metaRoot });
                                ^^^^^^^^^^
                                缺少 saveBlueprint 回调！
```

`AgentBirthEngine.birth()` 调用约定：

```typescript
// packages/meta-system/src/agent-birth.ts:59
if (this.deps.saveBlueprint) {
  await this.deps.saveBlueprint(blueprint);
}
await this.audit(result);  // 仅写 <rootDir>/agent-births/<id>.json
```

**实际发生**：
- `agent-births/bp-mobile_app_development_agent-v1-xxx.json` 写入 ✅
- `BlueprintStore`（`packages/dags/src/blueprint-store.ts`）**永不被写入** ❌
- `BlueprintGenerator` 看不到这个蓝图 ❌
- `DAGS.compose()` 看不到这个蓝图 ❌
- 实际请求永远不会被路由到这个新 agent ❌

**结论：Birth 只产生审计 JSON，不产生可执行蓝图。**

### 2.2 Retirement — 实际影响

```typescript
// apps/api/src/index.ts:208
const retirement = new AgentRetirementEngine();
                                       ^^^^^^^^^^
                                       缺少 retireBlueprint 回调！
```

`AgentRetirementEngine.evaluateAll()`：

```typescript
// packages/meta-system/src/agent-retirement.ts:91
const d = await this.evaluate(id, role, executions);
if (d) {
  decisions.push(d);
  if (this.deps.retireBlueprint) {   ← 永远不执行
    await this.deps.retireBlueprint(id);
  }
}
```

**实际发生**：
- `RetirementDecision` 写入 `MetaCycleResult` ✅
- `orgMemory.record("agent_retired", ...)` 写入 ✅
- `blueprint.retiredAt` **永远不被设置** ❌
- 该 agent 继续服务流量 ❌

### 2.3 Team Graph — 实际影响

`TeamOptimizer.suggest()` 返回 hint，但 hint **从不**被应用：

```typescript
// packages/meta-system/src/orchestrator.ts:202
const teamHint = await this.deps.teamOptimizer.suggest({...});
await this.deps.orgMemory.record("team_optimized", ...);
```

**没有 `applyTeamHint(teamHint)` 调用。** Hint 写入 `OrganizationMemory` 后即丢弃。

### 2.4 Mutation Effect Report

```json
{
  "phase6_mutations": {
    "AgentBirthEngine.birth": {
      "writes_to_filesystem": ["<rootDir>/agent-births/<id>.json"],
      "modifies_live_BlueprintStore": false,
      "affects_next_DAGS_compose": false,
      "produces_runtime_reachable_agent": false,
      "verdict": "AUDIT_ONLY"
    },
    "AgentRetirementEngine.evaluateAll": {
      "writes_to_filesystem": ["<rootDir>/org-events/<id>.json"],
      "sets_blueprint_retiredAt": false,
      "removes_agent_from_runtime": false,
      "affects_next_request_routing": false,
      "verdict": "AUDIT_ONLY"
    },
    "TeamOptimizer.suggest": {
      "writes_to_filesystem": ["<rootDir>/org-events/<id>.json"],
      "applies_hint_to_graph": false,
      "modifies_team_topology": false,
      "verdict": "AUDIT_ONLY"
    },
    "MetaAgent.decide": {
      "writes_to_filesystem": ["<rootDir>/org-events/<id>.json"],
      "executes_decision": false,
      "verdict": "AUDIT_ONLY"
    },
    "GovernanceEngine.check": {
      "writes_to_filesystem": ["<rootDir>/org-events/<id>.json (on violation)"],
      "blocks_cycles": false,
      "blocks_requests": false,
      "verdict": "AUDIT_ONLY"
    }
  },
  "summary": "Phase 6 produces 100% log-only mutations. No live system state is changed."
}
```

---

## 3. Capability 是否进入 runtime 决策？

### 3.1 两套 capability 系统并存

| 来源 | 模块 | 影响范围 |
|------|------|---------|
| `CAPABILITY_LIBRARY`（packages/dags/src/capability-library.ts） | DAGS.compose → CapabilityAnalyzer.analyze | **TRUE CORE** |
| `CapabilityRegistry`（packages/meta-system/src/capability-registry.ts） | MetaOrchestrator.cycle → CapabilityDiscoveryEngine | **SHADOW** |

### 3.2 实际依赖图

```
packages/dags/src/dags.ts:18
  import { CapabilityLibrary } from "./capability-library.js";

packages/dags/src/dags.ts:43
  class DAGS {
    readonly library: CapabilityLibrary;            ← 静态
    readonly analyzer: CapabilityAnalyzer;          ← 用 static library
    readonly store: BlueprintStore;                 ← 独立 file store
  }

packages/dags/src/dags.ts:67
  async compose(userRequest): Promise<ComposedTeam> {
    const capabilities = this.analyzer.analyze(userRequest);  ← 静态匹配
    const blueprints = await this.generator.generate(capabilities, ...);
    ...
  }
```

```
packages/meta-system/src/capability-registry.ts:27
  class CapabilityRegistry {
    async propose(...): Promise<CapabilityRecord> { ... }  ← 写 capability-registry/<id>.json
    async transition(...): Promise<CapabilityRecord> { ... }
  }
```

### 3.3 Runtime Dependency Map

```
CapabilityDiscoveryEngine.discover()
  └── writes capability-proposals/<id>.json              [audit only]
        ↓ (only on /api/meta/cycle call)

CapabilityRegistry.propose()
  └── writes capability-registry/<id>.json               [audit only]
        ↓ (no consumer)

CAPABILITY_LIBRARY                                     [TRUE CORE]
  └── DAGS.compose()
        └── BlueprintGenerator.generate() → blueprints
              └── AgentRuntime.execute() → real tasks
```

**结论：`CapabilityRegistry` 是给 `MetaOrchestrator.cycle()` 看的日志簿，`DAGS` 完全不知道它存在。**

---

## 4. Evolution 是否真实影响 model 选择？

### 4.1 真实路径

```typescript
// packages/evolution/src/factory.ts:20
export function evolutionAwareFactory(facade: EvolutionFacade) {
  return (role) => {
    const selection = facade.selectForRole(role);  // ★ 真实选择
    ...
    return new MemoryAugmentedAgent(inner, facade, selection);
  };
}

// packages/evolution/src/facade.ts:110
selectForRole(role: AgentRole): ModelSelection {
  return this.selector.select(role, this.leaderboard, { provider: ... });
}

// packages/evolution/src/selector.ts:60
select(role, board, fallback): ModelSelection {
  const entries = board.entriesFor(role);          // ★ 真实 leaderboard
  if (entries.length === 0) return fallback;        // ← 第一次无数据
  const scored = entries.map(e => ({ entry: e, score: this.scoreEntry(e) }));
  scored.sort((a, b) => b.score - a.score);
  return best scored;
}
```

### 4.2 Memory Injection — 真实

```typescript
// packages/evolution/src/factory.ts:50
override async receiveTask(task: Task, _ctx: AgentContext): Promise<void> {
  const profile = await this.facade.activeProfile(task.agentRole);
  const prelude = AgentMemoryStore.toPrelude(profile.memory);
  if (prelude) {
    const augmented = {
      ...this.inner.manifest,
      systemPrompt: this.inner.manifest.systemPrompt + prelude,  // ★ 真实注入
    };
    (this.inner as any).manifest = augmented;
  }
}
```

### 4.3 Model Selection Trace (example)

```json
{
  "request": { "userRequest": "Build a TODO app", "role": "frontend" },
  "selectorCall": {
    "path": "evolutionAwareFactory → facade.selectForRole → selector.select",
    "leaderboardEntries": [
      { "provider": "anthropic", "model": "claude-3-5-sonnet", "avgScore": 8.4, "sampleSize": 23 },
      { "provider": "openai", "model": "gpt-4o-mini", "avgScore": 7.1, "sampleSize": 41 }
    ],
    "scored": [
      { "entry": "anthropic/claude-3-5-sonnet", "score": 0.74 },
      { "entry": "openai/gpt-4o-mini", "score": 0.61 }
    ],
    "selected": "anthropic/claude-3-5-sonnet",
    "reason": "Highest composite score for frontend tasks (score 8.4/10 over 23 tasks).",
    "is_real_runtime_change": true
  },
  "firstCallWithNoHistory": {
    "selected": "fallback.provider",
    "reason": "No history yet — using default provider.",
    "is_real_runtime_change": true
  }
}
```

**结论：Model selection 和 memory injection 是 TRUE CORE。Evolution Planner / Candidate Generator / Promotion Engine 是 SHADOW（仅生成候选和计划，不应用到运行时）。**

---

## 5. DAGS vs Meta-system 关系

### 5.1 Control Hierarchy Graph

```
                       USER REQUEST
                            │
                            ▼
                       /api/chat
                            │
                            ▼
            ┌───────────────┴───────────────┐
            │                               │
            ▼                               ▼
    DAGS_MODE=false                  DAGS_MODE=true
            │                               │
            ▼                               ▼
       Commander.plan()                  DAGS.compose()
            │                               │
            ▼                               ├─► CapabilityLibrary (static)
       AgentRuntime                        ├─► BlueprintStore (independent)
            │                               ├─► ModelAssigner
            │                               │     └─► facade.selectForRole()
            │                               │           └─► leaderboard entries
            │                               ├─► AgentRuntime.execute()
            │                               └─► AutonomyOrchestrator.observe()
            │                                       ├─► ExecutionStore
            │                                       ├─► ReviewIntelligence
            │                                       ├─► InsightsStore + FailureAnalyzer
            │                                       ├─► EvolutionPlanner (proposals only)
            │                                       ├─► CandidateGenerator (drafts only)
            │                                       └─► PromotionEngine (logs only)
            │
            ▼
    (legacy evolution.recordCompletion hook)
            │
            └─► EvolutionFacade.recordCompletion()
                    ├─► MetricsStore.record()
                    ├─► ProfileStore.recompute()
                    └─► Leaderboard.rebuild()

═════════════════════════════════════════════════════════════════
                    Meta-system (META_AGENT_ENABLED)
═════════════════════════════════════════════════════════════════

   POST /api/meta/cycle  ─►  MetaOrchestrator.cycle()
                                    │
                                    ├─► CapabilityDiscoveryEngine
                                    │     └─► capability-proposals/*.json
                                    ├─► CapabilityRegistry
                                    │     └─► capability-registry/*.json
                                    ├─► AgentBirthEngine
                                    │     └─► agent-births/*.json (audit)
                                    ├─► AgentRetirementEngine
                                    │     └─► RetirementDecision[] (in-memory only)
                                    ├─► MetaAgent
                                    │     └─► AgentChangePlan (in-memory only)
                                    ├─► TeamOptimizer
                                    │     └─► TeamOptimizerHint (in-memory only)
                                    ├─► GovernanceEngine
                                    │     └─► GovernanceVerdict (in-memory only)
                                    └─► OrganizationMemory
                                          └─► org-events/*.json (audit)
```

### 5.2 关键洞察

- **DAGS 是主调度器**（TRUE CORE），所有用户请求必经此处。
- **Phase 4 Evolution 通过 `evolutionAwareFactory` 影响 model/prompt**（TRUE CORE）。
- **Phase 5 AutonomyOrchestrator.observe() 写 metrics、生成 plans/candidates**（SHADOW：plans/candidates 不写入 live agent）。
- **Phase 6 MetaOrchestrator 仅暴露在 `/api/meta/*`**（SHADOW：不进入请求路径）。

---

## 6. 三个分类

### 6.1 TRUE CORE SYSTEM（真实控制链路）

| 模块 | 路径 | 真实影响 |
|------|------|---------|
| `AgentRuntime.execute()` | packages/core/src/ | 真正执行 task |
| `Commander.plan()` | packages/commander/src/ | legacy 路径下产生 plan |
| `DAGS.compose()` | packages/dags/src/dags.ts | TRUE：动态组团队 |
| `CapabilityAnalyzer.analyze()` | packages/dags/src/capability-analyzer.ts | TRUE：决定需要哪些能力 |
| `BlueprintGenerator.generate()` | packages/dags/src/blueprint-generator.ts | TRUE：产生蓝图 |
| `ModelAssigner.assign()` | packages/dags/src/model-assigner.ts | TRUE：用 leaderboard 选 model |
| `evolutionAwareFactory` | packages/evolution/src/factory.ts | TRUE：注入 memory prelude |
| `EvolutionFacade.recordCompletion()` | packages/evolution/src/facade.ts | TRUE：更新 metrics/profile/leaderboard |
| `ModelSelector.select()` | packages/evolution/src/selector.ts | TRUE：选 model/provider |
| `MemoryAugmentedAgent.receiveTask()` | packages/evolution/src/factory.ts | TRUE：把 memory 注入 systemPrompt |
| `ExecutionStore.record()` | packages/autonomy/src/execution-store.ts | TRUE：记录每次执行（被 leaderboard 消费） |
| `ReviewIntelligence.review()` | packages/autonomy/src/review-intelligence.ts | TRUE：评分（被 leaderboard 消费） |

### 6.2 SHADOW SYSTEM（仅日志/建议，不影响 runtime）

| 模块 | 真实输出 | 影响 runtime？ |
|------|---------|---------------|
| `EvolutionPlanner.plan()` | EvolutionPlan JSON | ❌ 不写 live blueprint |
| `CandidateGenerator.generate()` | Candidate JSON | ❌ 不写 live blueprint |
| `PromotionEngine.evaluate()` | Decision JSON | ❌ 不替换旧 blueprint |
| `AutonomyOrchestrator.observe()` | 触发上面三个 | ❌ 仅作为调度入口 |
| `MetaAgent.decide()` | AgentChangePlan | ❌ 不创建/删除 agent |
| `TeamOptimizer.suggest()` | TeamOptimizerHint | ❌ 不修改 graph |
| `SimulationEngine.simulate()` | SimulationResult | ❌ 不应用到 live org |
| `GovernanceEngine.check()` | GovernanceVerdict | ❌ 不阻止 cycle |
| `MetaOrchestrator.cycle()` | 上面全部聚合 | ❌ 不挂任何事件源 |
| `LearningAPI.*` | dashboards | ❌ 仅 GET 端点 |
| `AgentBirthEngine.birth()` | agent-births/*.json | ❌ 不写 live BlueprintStore（缺回调） |
| `AgentRetirementEngine.evaluate()` | RetirementDecision | ❌ 不设置 retiredAt（缺回调） |
| `CapabilityDiscoveryEngine.discover()` | capability-proposals/*.json | ❌ DAGS 不读 |
| `CapabilityRegistry.propose/transition` | capability-registry/*.json | ❌ DAGS 不读 |
| `OrganizationMemory.record()` | org-events/*.json | ❌ 不被任何 runtime 组件消费 |

### 6.3 DEAD SYSTEM（未使用 / 不可达）

| 模块 / 端点 | 原因 |
|------------|------|
| `META_AGENT_ENABLED=true` 之外的 meta-system 路径 | 默认 false，所有 `/api/meta/*` 端点未挂载 |
| `MetaOrchestrator.cycle()` 在 production 触发 | 没有任何 scheduler / runtime listener 调用 |
| `SimulationEngine.compare()` | 端点存在但从未被 autonomy 或 DAGS 消费 |
| `AgentBirthEngine.saveBlueprint` 回调 | API 层未提供，永远走 audit-only 分支 |
| `AgentRetirementEngine.retireBlueprint` 回调 | API 层未提供 |
| `GovernanceEngine.check()` 的 `allowed=false` 分支 | orchestrator 写入 violation event 后继续 cycle |
| `apps/api/test/e2e-meta-mode.test.ts` 的 integration | 仅在测试中触发，production 无 trigger |

---

## 7. 强制要求产出物清单

### 7.1 真实 runtime trace

见 §1.1（runtime trace）和 §4.3（model selection trace）。所有节点均来自实际代码 grep，无 mock。

### 7.2 API 调用链（逐函数级别）

```
POST /api/chat
  └─ apps/api/src/routes/chat.ts::postChat
       ├─ ChatRequestSchema.safeParse          [apps/api/src/routes/chat.ts:28]
       ├─ if (dagsMode && dags && orchestrator):
       │   ├─ buildDagsWorkspace               [apps/api/src/dags-flow.ts:35]
       │   │   ├─ dags.compose                 [packages/dags/src/dags.ts:67]
       │   │   │   ├─ analyzer.analyze         [packages/dags/src/capability-analyzer.ts]
       │   │   │   ├─ generator.generate       [packages/dags/src/blueprint-generator.ts]
       │   │   │   ├─ graphBuilder.build       [packages/dags/src/team-graph-builder.ts]
       │   │   │   └─ assigner.assign          [packages/dags/src/model-assigner.ts:25]
       │   │   │       └─ facade.selectForRole [packages/evolution/src/facade.ts:110]
       │   │   │             └─ selector.select [packages/evolution/src/selector.ts:60]
       │   │   └─ saveWorkspace
       │   └─ runDagsFlow                       [apps/api/src/dags-flow.ts:93]
       │       ├─ dags.buildAgentFactory
       │       ├─ new AgentRuntime(...).execute
       │       ├─ saveWorkspace(final)
       │       └─ orchestrator.observe(final)   [packages/autonomy/src/autonomy-orchestrator.ts]
       │             ├─ review workspace
       │             ├─ recordExecutions
       │             ├─ mineFailurePatterns
       │             ├─ planner.plan           [packages/autonomy/src/evolution-planner.ts]
       │             ├─ candidateGenerator     [packages/autonomy/src/candidate-generator.ts]
       │             └─ promotionEngine.evaluate [packages/autonomy/src/promotion-engine.ts]
       └─ return { workspaceId, mode }

POST /api/meta/cycle  ←── 唯一调用 MetaOrchestrator.cycle()
  └─ apps/api/src/routes/meta.ts::runCycle
       └─ orchestrator.cycle(input)
             ├─ discovery.discover           [packages/meta-system/src/capability-discovery.ts]
             ├─ registry.propose             [packages/meta-system/src/capability-registry.ts]
             ├─ registry.transition          [...]
             ├─ birth.birth                  [packages/meta-system/src/agent-birth.ts]
             ├─ retirement.evaluateAll       [packages/meta-system/src/agent-retirement.ts]
             ├─ metaAgent.decide             [packages/meta-system/src/meta-agent.ts]
             ├─ teamOptimizer.suggest        [packages/meta-system/src/team-optimizer.ts]
             ├─ governance.check             [packages/meta-system/src/governance.ts]
             └─ orgMemory.record             [packages/meta-system/src/organization-memory.ts]
```

### 7.3 设计路径 vs 实际路径

| 设计意图 | 实际路径 | 偏差 |
|---------|---------|------|
| Meta-system 自动观察 → 调整 org | 需手动 `POST /api/meta/cycle` | **缺自动触发** |
| Birth 创建可执行 blueprint | 只写 audit JSON | **缺 saveBlueprint 回调** |
| Retire 阻止 agent 服务流量 | 只记录 decision | **缺 retireBlueprint 回调** |
| TeamOptimizer 改善 graph | 只产出 hint | **缺 applyHint** |
| CapabilityRegistry 影响 DAGS | DAGS 用静态 CAPABILITY_LIBRARY | **缺能力传播** |
| Governance 阻止越界 | 写入 violation event 后继续 | **缺硬阻断** |
| Model selection 用 leaderboard | ✅ 真实 | 符合 |
| Memory injection 影响 systemPrompt | ✅ 真实 | 符合 |

### 7.4 未被使用模块清单

| 模块 | 类型 | 触发条件（缺失） |
|------|------|-----------------|
| AgentBirthEngine.saveBlueprint | 回调 | API 层未注入 |
| AgentRetirementEngine.retireBlueprint | 回调 | API 层未注入 |
| MetaOrchestrator.cycle | 自动调度 | 缺 scheduler / runtime listener |
| SimulationEngine.compare | 应用 | 无 consumer |
| GovernanceEngine.check 的阻断逻辑 | 决策 | orchestrator 总是 continue |
| CapabilityRegistry → DAGS | 数据流 | DAGS 用静态 library，不读 registry |

### 7.5 真正影响 production 的模块列表

按"如果删除，行为变化"排序：

1. **`DAGS.compose`** — 没有它，所有请求都会走 Commander legacy 路径。
2. **`evolutionAwareFactory`** — 没有它，所有请求用 default provider，不注入 memory。
3. **`ModelAssigner.assign`** — 没有它，每个 node 没有 modelAssignment，会 throw。
4. **`EvolutionFacade.recordCompletion`** — 没有它，leaderboard 不更新，model selection 永远 fallback。
5. **`ModelSelector.select`** — 没有它，model selection 抛 "No leaderboard data"。
6. **`AgentRuntime.execute`** — 没有它，什么都不执行。
7. **`MemoryAugmentedAgent.receiveTask`** — 没有它，memory prelude 不注入。

---

## 8. 终极判定

### Q1：主流程是否真的被 Meta 系统接管？

**❌ 否。** Meta-system 在 production 完全不接入请求路径。仅在 `POST /api/meta/cycle` 时手动触发。

### Q2：Meta-Agent 是否真的在"改变系统结构"？

**❌ 否。** 所有 mutation 都是 audit JSON。`saveBlueprint` 和 `retireBlueprint` 回调缺失导致 birth/retirement 不修改 BlueprintStore。

### Q3：Capability 是否进入 runtime 决策？

**❌ 否。** DAGS 用静态 `CAPABILITY_LIBRARY`。`CapabilityRegistry` 是元数据日志簿。

### Q4：Evolution 是否真实影响 model 选择？

**✅ 是。** `evolutionAwareFactory` → `facade.selectForRole` → `selector.select(leaderboard)` 路径真实，从第二次起开始根据历史选 model。Memory prelude 注入也是真实的。

### Q5：DAGS vs Meta 系统关系？

**DAGS = 主调度器（TRUE CORE）**。Meta-system = **纯建议层（SHADOW）**。

---

## 9. 系统定性

> **这是一个"自描述 + 部分自进化"系统。**
>
> - **自进化部分**（TRUE CORE）：model 选择、memory injection、metrics/profile/leaderboard 更新。
> - **自描述部分**（SHADOW）：evolution plans、candidates、promotions、capability registry、team optimizer、governance verdicts、organization memory。
>
> 整套 Phase 5 + Phase 6 都是"我应该变成什么样"的描述，但没有"把我描述的东西变成真的"的最后一步。

要让系统真正自进化，需要补齐以下一个或多个步骤（**Phase 7 候选**）：

1. **API 层注入 `saveBlueprint`/`retireBlueprint` 回调**，让 birth/retirement 写到 `BlueprintStore`。
2. **`AutonomyOrchestrator.observe()` 末尾自动调用 `MetaOrchestrator.cycle()`**，让 cycle 在每次工作空间完成后自动触发。
3. **`MetaAgent` 的 `create`/`delete`/`merge`/`split` 决策自动应用到 BlueprintStore**。
4. **`TeamOptimizer` 的 hint 自动应用到下一个 `DAGS.compose`**（写到 graph builder 的 always-include 或 parallelize 指令）。
5. **`GovernanceEngine.check()` 的 `allowed=false` 真的阻断下一次 cycle**（写入 `governance-blocked.json` flag，cycle 开始时检查）。
6. **DAGS 增加 fallback 路径**：当 `CapabilityRegistry.listAll()` 有 active capability 而 `CAPABILITY_LIBRARY` 没有时，自动注册到 library。

补齐上述任何一项，系统都会从"自描述"进化为"自进化"。当前状态是"自描述 + 审计完整"。

---

## 附录 A：grep 证据

```bash
# MetaOrchestrator.cycle 唯一调用点
$ grep -rn "orchestrator\.cycle" apps/ packages/
apps/api/src/routes/meta.ts:116:      const result = await orchestrator.cycle(input);

# saveBlueprint 回调缺失
$ grep -A2 "new AgentBirthEngine" apps/api/src/index.ts
  const birth = new AgentBirthEngine({ rootDir: metaRoot });

# retireBlueprint 回调缺失
$ grep -A2 "new AgentRetirementEngine" apps/api/src/index.ts
  const retirement = new AgentRetirementEngine();

# DAGS 不读 CapabilityRegistry
$ grep -rn "CapabilityRegistry" packages/dags/src/
(no results)

# Meta-system 不进入 runtime 路径
$ grep -rn "metaOrchestrator" apps/api/src/
apps/api/src/index.ts:198:let metaOrchestrator: MetaOrchestrator | undefined;
apps/api/src/index.ts:214:  metaOrchestrator = new MetaOrchestrator({ ... });
apps/api/src/index.ts:374:if (metaOrchestrator && metaGovernance ...) {
```

## 附录 B：truth-audit-outputs（机器可读）

```json
{
  "audit_version": "phase6.5-2026-06-22",
  "q1_chat_call_chain_taken": "DAGS.compose → BlueprintGenerator → ModelAssigner → AgentRuntime",
  "q1_meta_system_invoked": false,
  "q2_meta_mutations": {
    "birth_affects_runtime": false,
    "retirement_affects_runtime": false,
    "team_graph_mutated": false,
    "graph_change_log_only": true
  },
  "q3_capability_runtime_dependency": {
    "CapabilityRegistry_referenced_by_runtime": false,
    "CAPABILITY_LIBRARY_used_by_runtime": true
  },
  "q4_model_selection_real": true,
  "q5_control_hierarchy": {
    "main_scheduler": "DAGS",
    "meta_layer_role": "advisory",
    "autonomy_layer_role": "observation_and_logging"
  },
  "classification": {
    "TRUE_CORE": ["DAGS.compose", "evolutionAwareFactory", "ModelAssigner", "ModelSelector", "MemoryAugmentedAgent", "AgentRuntime", "EvolutionFacade.recordCompletion"],
    "SHADOW": ["EvolutionPlanner", "CandidateGenerator", "PromotionEngine", "MetaAgent", "TeamOptimizer", "SimulationEngine", "GovernanceEngine", "MetaOrchestrator", "LearningAPI", "AgentBirthEngine", "AgentRetirementEngine", "CapabilityDiscoveryEngine", "CapabilityRegistry", "OrganizationMemory"],
    "DEAD": ["saveBlueprint callback (missing)", "retireBlueprint callback (missing)", "Meta-system auto-trigger", "SimulationEngine.compare consumer", "Governance hard-block"]
  },
  "final_verdict": "This system is self-DESCRIBING, partially self-EVOLVING. Phase 4 model selection + memory injection are real. Phase 5/6 are audit-only."
}
```