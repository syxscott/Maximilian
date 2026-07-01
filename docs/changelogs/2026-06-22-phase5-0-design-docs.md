# Changelog — 2026-06-22 (Phase 5.0：设计文档落盘)

## 完成内容

落盘 5 份 Phase 5 设计文档：

| 文件 | 内容 |
|---|---|
| `docs/architecture/phase5-autonomy.md` | 整体架构 — 8 个子阶段、模块依赖、数据流 |
| `docs/architecture/phase5-data-flow.md` | 数据流图 (mermaid) — workspace → observe → candidate → promote |
| `docs/architecture/phase5-storage.md` | 存储布局 — executions/, reviews/, insights/, evolution-plans/, agent-versions/, promotion-history.json |
| `docs/architecture/phase5-algorithms.md` | 算法伪代码 — review scoring、pattern mining、planner、promotion |
| `docs/reports/phase5-risk-analysis.md` | 风险分析 — 10 个风险 + 缓解 |

并落盘 4 份 ADR（编号 015-018）：

| ADR | 主题 |
|---|---|
| adr-015 | ExecutionRecord 应当可重放（包含全部上下文） |
| adr-016 | Review 必须结构化（strengths/weaknesses/failure_patterns/suggestions） |
| adr-017 | Promotion 走 A/B 规则（minSample=20, score≥10%, accept≥15%） |
| adr-018 | DAGS_MODE 开关控制主流程切换 |

## 修改文件

无

## 新增文件

- `docs/architecture/phase5-autonomy.md`
- `docs/architecture/phase5-data-flow.md`
- `docs/architecture/phase5-storage.md`
- `docs/architecture/phase5-algorithms.md`
- `docs/reports/phase5-risk-analysis.md`
- `docs/decisions/adr-015-execution-replayable.md`
- `docs/decisions/adr-016-structured-review.md`
- `docs/decisions/adr-017-ab-promotion.md`
- `docs/decisions/adr-018-dags-mode.md`

## 删除文件

无
