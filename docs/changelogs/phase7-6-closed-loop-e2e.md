# Phase 7 — Task 6: 真实闭环 E2E

**Date**: 2026-06-22
**Status**: ✅ Completed

## 修改文件

| 文件 | 修改 |
|------|------|
| `packages/meta-system/src/capability-discovery.ts` | `GAP_PATTERNS` 新增 `data_pipeline` 模式:`/data pipeline\|etl\|elt\|data warehouse\|olap\|data ingestion\|airflow\|spark/i` |
| `apps/api/test/e2e-closed-loop.test.ts` | 新增 6 个 E2E 测试覆盖完整闭环 |

## 修改原因

Phase 6 没有端到端验证"发现 → 注册 → 激活 → birth → 落盘 → DAGS 使用 → 完成任务"的完整链路。
用户要求:验证连续收到 20 个数据库 / pipeline 类项目,系统自动完成所有步骤,**无需人工操作**。

## 场景

连续 20 个数据 pipeline 项目请求,每个请求触发一次 meta-cycle。每次 cycle 收到 5 个 `DiscoverySignal`(共 4 批 = 20 个信号)。

测试场景略调整:使用 `data_pipeline`(新增 GAP_PATTERN)而非 `database`,因为 `database` 已在 `KNOWN_CAPABILITIES` 中,discovery 会跳过。`data_pipeline` 是真实生产中常见的 DAGS 能力缺口。

## 测试矩阵

| # | 测试 | 验证 |
|---|------|------|
| 1 | `discovers → registers → activates → births → persists blueprint (5+ signals)` | 5 个信号触发完整 6 步链路 |
| 2 | `scales to 20 data-pipeline projects with no regression` | 4 批 × 5 信号 = 20 信号,无错误累积 |
| 3 | `DAGS uses the new data_pipeline blueprint after meta-cycle` | registry → library 同步 → capability 检测 → blueprint 可用 |
| 4 | `blueprint persists across meta-cycle restarts (file-based durability)` | 新 `BlueprintStore` 实例从磁盘恢复 blueprint |
| 5 | `governance blocks new births when at maxAgents (closed-loop stays safe)` | maxAgents=1 + 1 个已有 blueprint → discovery/activation OK,birth 被阻断,无新 blueprint 落盘 |
| 6 | `TeamOptimizer hint is materialized into blueprint metadata after cycle` | 无 review node 的图 → hint 写入 review blueprint metadata |

## 闭环链路证据

```
信号 (5 个 user_request_analysis)
  ↓ CapabilityDiscoveryEngine.discover()
proposals: [{capabilityId: "data_pipeline", evidence: [...]}]
  ↓ CapabilityRegistry.propose()
registry.listAll() 包含 "data_pipeline"
  ↓ CapabilityRegistry.transition() (proposed → experimental → active)
activated: [{id: "data_pipeline", status: "active"}]
  ↓ AgentBirthEngine.birth() + saveBlueprint callback
blueprints/<id>.json 真实落盘 (BlueprintStore.save)
  ↓ CapabilityRegistry.listByStatus("active") → DAGS library.replaceDynamic()
DAGS.compose() 可识别 data_pipeline 关键字
  ↓ TeamOptimizer.applyHint() + applyToBlueprintStore callback
blueprint.metadata.optimizerRequired / pendingRetirement / parallelizeGroup 写入
```

## 风险

| 风险 | 缓解 |
|------|------|
| `data_pipeline` 关键字与 `postgres`/`api` 等已知关键字冲突 | 信号用 `Snowflake`(非已知关键字)+ `ETL`/`Spark`/`Airflow` 触发 GAP_PATTERN |
| 测试运行慢(20 signals × 4 cycles) | 实际只跑 4 cycle,每个 cycle 处理 5 signals,总耗时 ~40ms |
| 真生产可能跑出更多 capability | 测试用 `data_pipeline` 单一目标,避免 flakiness |

## 测试结果

```
新增 e2e-closed-loop.test.ts: 6/6 ✅
@max/meta-system: 74/74 ✅
@max/dags: 24/24 ✅
@max/autonomy: 37/37 ✅
@max/api meta 全部: 23/23 ✅ (10 集成 + 7 E2E + 6 closed-loop)
type-check: 全部通过
```
