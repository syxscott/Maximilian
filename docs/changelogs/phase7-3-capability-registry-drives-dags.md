# Phase 7 — Task 3: CapabilityRegistry 接管 DAGS

**Date**: 2026-06-22
**Status**: ✅ Completed

## 修改文件

| 文件 | 修改 |
|------|------|
| `packages/dags/src/capability-library.ts` | `CapabilityLibrary` 新增 `replaceDynamic(caps)` 方法 + `listDynamic()` 方法;跟踪 `dynamicIds` 集合 |
| `packages/dags/src/dags.ts` | `DAGSOptions` 新增 `syncDynamicCapabilities?: () => Promise<Capability[]>`;`compose()` 在 analyze 之前调用此 hook 并 `library.replaceDynamic()` |
| `apps/api/src/index.ts` | 提升 `metaRegistry` 到外层作用域;`DAGS` 构造时注入 `syncDynamicCapabilities` 回调;新增 `syncRegistryToDags()` + `deriveKeywords()` 辅助函数 |

## 修改原因

DAGS 启动时 `CapabilityLibrary` 用硬编码的 11 个 `CAPABILITY_LIBRARY` 静态项填充。整个生命周期内这个 library 不会变化,所以 meta-system 发现的任何新 capability 都无法进入 DAGS —— 即便 `AgentBirthEngine` 写了蓝图,`CapabilityAnalyzer.analyze()` 也不会识别这个新能力。

要求:新增 capability 后无需重启即可参与团队生成。

## 架构变化

```
Before (Phase 6):
  DAGS.compose() 
    → CapabilityAnalyzer( static CAPABILITY_LIBRARY )  // 11 个固定项
    → BlueprintGenerator( static library )
  → CapabilityRegistry 发现的 capability 永远进不来

After (Phase 7 Task 3):
  DAGS.compose()
    → metaRegistry.listByStatus("active")               // 每次重新读
    → syncRegistryToDags() → Capability[] (动态 capability)  // 转换
    → library.replaceDynamic(dynamicCaps)               // 替换
    → CapabilityAnalyzer( static + dynamic )
    → BlueprintGenerator( static + dynamic )
  → 新 capability 立即可被 DAGS 识别
```

`replaceDynamic()` 语义:
- 删除上次注入的所有 dynamic IDs(防止退役的 capability 残留)
- 插入当前 active 集合
- 保留所有构造时注入的静态能力(frontend / backend / devops / ...)

## `CapabilityRecord` → `Capability` 转换规则

由于 meta-system 的 `CapabilityRecord` 是 lifecycle 状态机,DAGS 的 `Capability` 是数据规格,需要补字段:

| Capability 字段 | 来源 |
|---|---|
| `id` / `displayName` / `description` | 直接来自 CapabilityRecord |
| `category` | `"general"` (无法精确推断) |
| `keywords` | 从 `id` + `displayName` 分词(`mobile_app_development` → `mobile`, `app`, `development`) |
| `defaultGoal` | 模板: `Deliver ${displayName} work for: {{userRequest}}` |
| `promptTemplate` | 模板: `You are a ${displayName} agent. Address: {{userRequest}}` |
| `defaultTools` | `[]` |
| `defaultConstraints` | `{ outputFormat: "code" }` |
| `dependsOn` / `tags` | `[]` / `["dynamic", "registry"]` |

## 风险

| 风险 | 缓解 |
|------|------|
| 注册新 capability 时 prompt 模板粗糙 | Phase 8 可让 `AgentBirthEngine` 写入 `promptTemplate` 字段进 registry |
| 同步回调失败影响 compose | try/catch 包裹,失败用 stale library 继续 |
| 动态 capability 数量过多 | `GovernanceEngine.maxCapabilities` 在 cycle 阶段已限制;此处不重复检查 |
| `dynamicIds` 集合追踪失误 | replaceDynamic 内严格清理所有先前 dynamic 记录 |

## 测试结果

```
@max/dags: 24/24 ✅ (含 CapabilityLibrary 新行为)
@max/meta-system: 71/71 ✅
@max/api meta: 17/17 ✅
type-check: 全部通过
```
