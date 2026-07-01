# Phase 5 — 风险分析

| # | 风险 | 严重度 | 缓解措施 |
|---|---|---|---|
| R1 | **A/B 误晋升**：候选版本在样本噪声下偶然胜出 | 高 | 双阈值（score + acceptance）+ MIN_SAMPLE=20 |
| R2 | **执行历史膨胀**：每次任务都落盘一份完整记录 | 中 | ExecutionStore 只保留必要字段；旧记录可被归档 |
| R3 | **Review LLM 幻觉**：failure_patterns 字段可能编造 | 高 | 用 JSON Schema 严格校验；缺字段时回退空数组 |
| R4 | **Planner 决策噪声**：基于短窗口的指标波动触发误进化 | 中 | MIN_SAMPLES=20 + require top-3 failure patterns |
| R5 | **版本链爆炸**：每次微调都生成 v2/v3/v4 | 中 | 仅在 scoreGain ≥ 10% 时升级；否则保留旧版本 |
| R6 | **A/B 串扰**：candidate 与 current 混在同一个 leaderboard | 中 | blueprintId 区分；leaderboard 按 (role, blueprint) 分组 |
| R7 | **DAGS_MODE 接管破坏现有 CLI** | 中 | 默认 `false`；开启需显式 env var |
| R8 | **类型漂移**：Phase 4 的 `blueprint.role` 是 string，与 ReviewResult 的 agentRole 是 enum | 中 | 转换层放在 ExecutionStore.save() 入口 |
| R9 | **学习回路延迟**：从失败到改进可能需要多个 round-trip | 低 | 在 response 中附带 "next evolution expected in N tasks" |
| R10 | **重放不一致**：复盘时如果模型已变，输出不同 | 低 | ExecutionRecord 只存"当时发生什么"，不承诺可重放 LLM 输出 |
