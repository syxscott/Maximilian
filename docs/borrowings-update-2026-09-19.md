# 开源项目更新与可借鉴点调研报告(2026-09-19)

> 两份新材料:minimax-code(MiniMax 终端编码 agent,pnpm monorepo,与本仓库同类)与
> ICLR 2026 论文《Cache-to-Cache: Direct Semantic Communication Between LLMs》
> (arXiv 2510.03215)。本报告记录全部落地项;出处与诚实边界逐条标注。

## 一、已落地(本轮实现,全部有测试)

| #   | 借鉴项                    | 来源                                                     | 实现                                                                                                                                                                                    | 测试                                 |
| --- | ------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 1   | 工具循环激活              | minimax-code Extension SPI(装配式 turn)                  | `createDefaultAgentFactory` 为每个 agent 挂权限门控的 ToolEnabledProvider(review 只读);`TOOL_LOOP_ENABLED` 默认 true;api/worker 传入 enableToolLoop                                     | factory 挂载/allowlist 5 用例        |
| 2   | 权限服务接入              | opencode always-追溯 + deepseek fail-closed              | PermissionService 成为 runtime 权限 parking 的策略层:allow-always 存 pattern 并批量自动放行匹配 ask、reject 批量拒绝、超时 fail-closed(unavailable);决策类型全链扩为 allow-always       | always/timeout/batch-reject 集成测试 |
| 3   | PermissionDenied 循环安全 | 同上                                                     | 门控 deny 现在以工具错误呈现而非炸掉 runToolLoop(此前路径不可达)                                                                                                                        | e2e 秘密路径拒绝                     |
| 4   | followup 无界续跑         | pi agent-loop 外层 while                                 | 自然退出且有 followup 时 re-enter 循环(共享 maxRounds 上限),续跑响应可再发工具调用                                                                                                      | 续跑语义测试                         |
| 5   | steering 幂等收据         | mcode steer-session                                      | `steerChecked` 返回 {accepted, receiptId, duplicate},60s (source,text) 去重窗;chat 路由透传收据                                                                                         | —                                    |
| 6   | LLM 重试状态事件流        | mcode llm-retry.ts                                       | providers 重试 bus(waiting/recovered/exhausted)→ runtime `llm-retry-status` 事件 → SSE → TUI 状态行 "Retrying · n/m · next in Xs"                                                       | bus+渲染断言                         |
| 7   | 通信 handoff 预算         | C2C Table 3/5(通信文本是一等成本项)                      | `renderHandoffBundle`:HANDOFF_BUDGET_TOKENS(默认 4000)代码级截断 + 自报 "… showing first N of M chars";review bundle 与 replanner 摘要接入;`maximilian_communication_tokens_total` 计数 | 截断/自报/预算测试                   |
| 8   | sharer 质量门             | C2C §A.4.6(弱 Sharer 误导强 Receiver)                    | failureDetector 标记的产物在下游 ctx 中降级为 "[unverified draft]"                                                                                                                      | —                                    |
| 9   | lesson 门控               | C2C Table 10/8(注入有选择性:28 层仅 2 层获益;门控 +3.07) | AgentMemory 每桶 efficacy 台账(delta=reviewScore−角色滚动基线);toPrelude(off/shadow/enforce):enforce 跳过显著负效桶;LESSON_GATING 默认 shadow                                           | 三态门控测试                         |
| 10  | Oracle 三元组             | C2C §A.3.1(先测注入上限再工程投入)                       | `runOracleTriad`:direct/few-shot/oracle 三臂 + PGR(性能差距回收率)+ 防泄漏目录约定 + OracleLessonsMissingError                                                                          | PGR/缺失语料测试                     |
| 11  | 翻转矩阵                  | C2C Fig 7(均值可掩盖双向翻转)                            | `computeFlipMatrix`:newlyCorrect/newlyWrong/transferRate/net                                                                                                                            | 2 用例                               |
| 12  | ToolKind 注册强制         | ToolKind 枚举借鉴收尾                                    | 注册时强制合法 kind(此前 capability lattice 仅测试可达)                                                                                                                                 | 存量测试全部声明 kind                |
| 13  | runaway-guard 扩展        | mcode agent-extension/runaway-guard                      | `createRunawayGuard`:连续 N 轮无工具调用 → 一次性策略提醒(onStepEnd 缝);shadow 模式                                                                                                     | patience/shadow/one-shot             |
| 14  | tool-output-budget 扩展   | mcode tool-output-budget + C2C 成本教训                  | `createToolOutputBudget`:超限输出外置为文件 artifact + 有界回执(防单次巨输出逐轮征税);runToolLoop 的 afterToolCall 支持异步                                                             | 外置/不触碰两路 e2e                  |
| 15  | OAuth 租约协议包          | mcode oauth-lease-protocol + oauth-core + lease-broker   | `packages/credential-lease`:capability file(0600/原子写)+ Unix socket 严格帧 + 认证状态机(generation)+ 租约 broker(单飞/吊销/retry-logout)                                              | 协议单测(独立包)                     |
| 16  | SQLite 会话存储           | mcode local-runtime-v2 持久层("双写+兼容读"迁移模式)     | `packages/session-store`:8 表精简 schema + 幂等 migrate + steering 收据持久化 + efficacy 台账持久化 + legacy JSONL 兼容读/迁移                                                          | 往返/幂等/坏行容忍                   |

## 二、诚实边界

- **C2C 核心机制**(投影模块、dynamic weighting、Gumbel 门控、终端层对齐、token 重编码)
  需要模型权重与训练设施,对调用托管 API 的本仓库**理念-only**。真正移植的是三件
  非模型资产:①Oracle 三元组实验纪律;②"注入有选择性、必须逐目标测 efficacy"的结论
  (填补了 memory 盲注入空白);③"通信文本是一等成本项"的记账与预算。cache 相关收益
  在托管世界退化为前缀缓存纪律,量级远小于论文的 2.5× 端到端加速,实现成本也相应只有 S-M。
- **minimax-code 的 Extension SPI 全量形态**(9-hook + ProfileOverlay + 装配诊断)本轮取
  最小缝(onStepEnd/before/afterToolCall 已有);ProfileOverlay 级别的 per-session 扩展
  管理未引入——等工具循环在生产中验证后再评估是否值得。
- **教训门控粒度**:论文的门是可学习参数;本实现是逐 (role, bucket) 的在线统计,方差大,
  故默认 shadow、先不做单条 lesson 粒度。
- legacy JSONL 的迁移与持久化重放(replay)依赖 SQLite 落地后的 audit 表;进程内
  PermissionService 的审计当前仅内存 + 事件流。

## 三、明确不借鉴的

- mcode 的 Effect/HTTPApi 契约层与 15 包拆分粒度(本仓库包结构已稳定)。
- C2C 的多 Sharer 中心化潜空间(O(N) fuser)——workspace 摘要已是其编排层类比,等
  N² 通信成为实测瓶颈再考虑。
- 强顾问模式与 query 级难度路由(设计已就绪:复用 handoff 预算通道 + router 前置层,
  默认 off;待 TOOL_LOOP 在生产验证后一起评估)。
