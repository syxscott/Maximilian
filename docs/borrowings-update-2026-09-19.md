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

## 四、2026-09-22/23 追加:ZCode 批次 + 接线批次

> 新来源:zai-org/ZCode(zai 的终端编码 agent)。两批工作:①移植其独立模块(925dba6);
> ②给已移植但零消费方的模块补真实接线(f17d9ea/bbd28f9/da47d89/e096186/355f222/fd968a2)。

### 4.1 已落地

| #   | 借鉴项           | 来源                       | 实现                                                                                                                                                                                                                       | 测试                                                |
| --- | ---------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 17  | 模型目录三级加载 | ZCode provider-node        | ModelCatalog(远程 models.dev → 温缓存 → 内嵌快照)接进 registry:attachCatalog + getEffectiveDefaultModel 查询目录;slug 别名表(kimi→moonshotai、zhipu→zhipuai、dashscope→alibaba)+ flagship 选取(最高档 + 最新 release_date) | 别名/flagship/解析 9 用例                           |
| 18  | 远程目录同步器   | ZCode remote-synchronizer  | RemoteCatalogSynchronizer:HTTPS-only 边界、20s 总预算、租约控制文件、指数退避(退避检查在抢租约之前——否则滑动永不到期)、lastSuccessAt 间隔门                                                                                | 退避/间隔回归 4 用例                                |
| 19  | 原生厂商预设更新 | 各厂商 2026-09 阵容        | deepseek-v4-pro / kimi-k3 / MiniMax-M3 / glm-5.3 / qwen3.8-max + 163 个转售渠道预设跟进官方五家                                                                                                                            | presets 测试                                        |
| 20  | 架构治理         | ZCode architecture lint    | architecture-policy.yaml + scripts/architecture-check.mjs(入口存在、禁包内部深导入、禁 app 互引)接入 CI                                                                                                                    | CI 步骤                                             |
| 21  | 工作流引擎       | ZCode dynamic-workflow     | packages/workflow-engine:journal 短路恢复、字节级 script-hash 拒绝、phase 进度;api `/api/workflows/run                                                                                                                     | :runId` LLM 链管线消费(进程内 journal,诚实边界见下) | 引擎 5 用例 |
| 22  | 崩溃预算         | ZCode crashBudget          | CrashBudget 挂 worker BullMQ failed/completed:同工作区反复崩溃 → 丢弃剩余重试(结构化 reason),干净完成重置                                                                                                                  | 既有单测                                            |
| 23  | 加密凭证库接线   | hermes Credential Vault    | Vault(AES-256-GCM/opaque handle/redaction)成为 providers 凭证源:`provider:<presetId>` 条目启动时并入 env;registry 的 env-only 契约不变;错口令降级不炸启动                                                                  | core 4 用例                                         |
| 24  | truth-audit 闭合 | hermes 用量锚点 + 残差对比 | TruthCalibrator:rollout 后按角色指标(基线锚窗 vs 后窗)算真实 delta,resolveMeasurement 原位替换开放预测(保 recordedAt 即持久化身份);runCycle 前自动解析                                                                     | 校准器 5 用例                                       |
| 25  | promotion 写回   | (既有缺口的闭合)           | AutonomyDeps.applyPromotion:promote 裁决把 candidate 的 systemPrompt/version 写回活蓝图(api/worker 经各自 BlueprintStore)——此前只记历史不落地                                                                              | 写回 2 用例                                         |
| 26  | 会话存储双写     | mcode 双写迁移模式(接线)   | session-store 接进 api/worker runtime.on:事件镜像 + plan.userRequest→user 消息 + result.output→assistant 消息 + usage + steering 收据闭环(text 匹配消费)                                                                   | 监听器 6 用例                                       |
| 27  | worker 自治闭环  | (既有缺口的闭合)           | queue 模式下 worker 构造 autonomy 栈并在 done 事件调 orchestrator.observe——此前 observe 只在 api 本地路径跑,排队工作区永远不被观察                                                                                         | (复用 observe 测试)                                 |
| 28  | TUI 源码净化     | —                          | 删除 src/ 下 122 个陈旧编译 .js 双胞胎(-15409 行),只留 .ts/.tsx 源                                                                                                                                                         | tsc + 14 用例                                       |

### 4.2 诚实降级(移植了核心、但宿主功能尚不存在)

以下模块核心 + 测试已就位,**刻意不接线**——宿主功能不存在,硬接等于给不存在的产品面造接缝:

- **planImageEviction**(图像批量逐出):本代码库没有图像输入管线(chat 路由无图像附件路径)。等图像输入落地时是现成策略。
- **ActivationPool**(子代理活跃容量池):防嵌套委托死锁;本 runtime 是平铺任务波 + 信号量,没有嵌套委派。等 subagent 编排落地。
- **PendingSlotManager**(cron exactly-once + 不可达阶梯):本代码库没有 cron 调度器。
- **CapabilityTicketStore**(单次能力票据):其设计场景(WS 角色提升、跨租户审批中转)在当前 api/gateway 中不存在。
- **RemoteCatalogSynchronizer**:ModelCatalog 已有自带锁 + 定时刷新;同步器保留为需要租约控制同步的调用方使用(文档已如实标注)。

### 4.3 其余诚实边界

- 工作流引擎的 api journal 是进程内 Map:重试内恢复可用,跨重启恢复需要 SQLite 版 WorkflowJournalPort(session-store events 表),标注在路由头。
- truth 校准的角色联动是 best-effort:discovery 提案的 capabilityId 直接当角色键;无指标历史的提案保持 pending,不猜。cost/risk 维度无锚点时解析为 0(= 无观测变化),不编造。
- HITL merge/split/rebalance_team 仍走"记录审批、下轮重提具体 mutation"路径;端到端 hint 物化需 TeamOptimizer 接线,未做。
