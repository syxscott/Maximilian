# Phase 4 — 风险分析

| # | 风险 | 严重度 | 缓解措施 |
|---|---|---|---|
| R1 | **能力识别准确率低**：LLM 可能漏识别或错识别 | 高 | 关键词匹配 + LLM 推断 + 兜底默认；用户可在请求中显式列出能力 |
| R2 | **Blueprint 质量方差大**：LLM 生成的 prompt 质量不稳定 | 中 | 模板化 prompt（占位符替换）+ 强制约束；版本化后可被 evolution 优化 |
| R3 | **Team Graph 循环**：依赖关系错乱导致死锁 | 高 | Kahn 算法 + 循环检测 + 失败时返回明确错误 |
| R4 | **冷启动无模型选择数据**：第一次运行任何角色时无历史 | 中 | Evolution 已实现 fallback：使用 provider.defaultModel |
| R5 | **持久化并发写**：蓝图/图可能与运行同时被写 | 中 | 每个请求独立 teamId；append-only JSON；不做 in-place mutation |
| R6 | **与 Commander 现有 Plan 格式不兼容** | 高 | 转换层：TeamGraph → Plan (Task[])，复用现有 runtime |
| R7 | **更多 Agent = 更多 LLM 调用 = 成本上升** | 中 | 层内并行 + 共享 prompt 前缀；evolution 阶段会优化模型选择 |
| R8 | **能力库规模爆炸**：每个项目都新增能力导致污染 | 低 | 标签化 + 按 category 分组；提供 `cleanupUnused()` |
| R9 | **版本链断**：进化过程中 parentId 找不到 | 低 | 总是保留所有历史版本，不删除 |
| R10 | **动态 Agent 与静态 AgentRole 类型冲突** | 中 | Agent 内部使用 string role；转换为 AgentRole 仅在 plan.task.agentRole 时做一次映射 |
| R11 | **Model Assignment 与 LLM 执行模型不一致** | 中 | 通过 `provider.id` 和 `model.name` 强制一致；测试覆盖 |
| R12 | **TypeScript 类型泛化** | 中 | Blueprint 中 role 是 string；运行时的 Agent 继承自基类 |

## 缓解策略总览

- 所有 6 个阶段都有单元测试
- E2E 验证（3 个 case）证明端到端可行
- 不修改现有 `defaultAgentFactory` 与 `AgentRuntime`
- 动态工厂是新工厂 `DynamicAgentFactory`，通过 `evolutionAwareFactory` 链入
