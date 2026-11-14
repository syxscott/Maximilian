# Borrowings update — 2026-10-03

全量借鉴批次（用户指令"全部借鉴"）：把待借鉴池中尚未落地的条目全部实现。
本文承接 `borrowings-update-2026-09-19.md`（M1–M5）与提交 `4b30eb4`（hermes/deepseek
最新一轮：RemoteError、ActivationPool、图像逐出、Vault 核心、cron pending-slot、
tool 负结果门、durable omission sink、auto-review、aux 加固、session 迁移/rewind/timeline）。

## 本批新增（4 个来源）

### minimax-code（v0.5.5–0.6.1）

| 条目                                          | 落点                                          | 说明                                                                                                     |
| --------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Session cascade（停止传播）                   | `packages/core/src/stop-cascade.ts` + runtime | 父任务停止级联到全部子/后台任务，回收部分结果                                                            |
| Stop suppression window（停止抑制窗）         | `packages/core` + runtime                     | 显式停止后短窗（默认 5s）内抑制自动恢复类触发（自动续跑/队列重投/cron 重拉起）                           |
| Bash task settlement（后台任务结算）          | `packages/core/src/bash-settlement.ts`        | 后台 bash 任务中断时产出结算记录：cancelled 标记 + 部分输出快照 + 耗时 + 结算原因                        |
| Goal final reply（终答状态机）                | `packages/core/src/goal-final-reply.ts`       | idle→working→final-reply→closed 状态机，终答恰好一次，经 runtime 事件流发出                              |
| 历史 SHA-256 完整链                           | `packages/session-store`                      | 消息表 prev_hash/hash 链式写入，`verifyHistory` 走链校验；legacy 段（NULL 哈希）不报错；软删除行仍在链中 |
| （此前已落地）34 套 TUI 主题 / TPS / 模型收藏 | `apps/tui/src/theme`、dashboard               | 2026-09 批次随 GUI 扩展落地                                                                              |

### swarms（agency-swarm / openai-swarm）

| 条目              | 落点                                  | 说明                                                                                                |
| ----------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 错误分类 taxonomy | `packages/core/src/error-taxonomy.ts` | 闭集分类（transient/permanent/context_limit/rate_limit/cancelled/unknown）+ 每类重试/重置策略判定   |
| 批量状态重置      | `packages/queue`                      | 崩溃恢复时按分类处理 running 僵尸态：transient 重置回可重试，permanent/cancelled/unknown 不动并计数 |

### oh-my-claudecode

| 条目                   | 落点                 | 说明                                                                                                             |
| ---------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 远程审批门             | `apps/api`           | `REMOTE_APPROVAL_GATE`（默认 true）：远程来源的审批需过显式门，未过门时保持 pending-gate，自动放行路径结构化拒绝 |
| Git shadow-commit 回滚 | `packages/workspace` | 批量写前存影子 ref（不动 HEAD/分支），`rollbackToShadow`，LRU 有界（默认 5）                                     |

### openclaw

| 条目         | 落点                 | 说明                                                                             |
| ------------ | -------------------- | -------------------------------------------------------------------------------- |
| 入站队列三层 | `apps/api`           | immediate / queued（有界）/ dead-letter（溢出拒收 + 结构化错误 + 计数）          |
| 写安全协调器 | `packages/workspace` | 按锁键租约串行化冲突写：同键互斥、异键并行、等待超时、多键全序获取防死锁         |
| 审计账本     | `packages/workspace` | append-only + 前向哈希链，覆盖审批放行 / shadow-commit / 写租约，verify() 校验链 |

### hermes（goal-judge）

| 条目              | 落点                   | 说明                                                                                                                                          |
| ----------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| goal-judge 四裁决 | `packages/meta-system` | {achieved / partially_achieved / failed / blocked} 结构化裁决 + 理由 + 置信度，含确定性 fallback judge，映射到 goal/TruthMeasurement 生命周期 |

## 新增配置键

| 键                       | 默认   | 说明                                                                                  |
| ------------------------ | ------ | ------------------------------------------------------------------------------------- |
| `REMOTE_APPROVAL_GATE`   | `true` | 远程来源的权限 allow 需 loopback 显式 release（`POST /api/permissions/gate/release`） |
| `INBOUND_MAX_INFLIGHT`   | `64`   | 入站三层队列的并发处理上限                                                            |
| `INBOUND_QUEUE_CAPACITY` | `256`  | 入站等待队列容量；溢出 503 + `inbound_overflow`                                       |

停止抑制窗/结算等参数为 runtime 选项（`stopSuppressionWindowMs` 默认 5000、`cascadeSettlementTimeoutMs`），不设环境变量键。

## 接线（本批集成补齐，杜绝"实现了但没人用"）

落地不是终点——以下每条链路都在本轮集成中接到了真实消费者：

1. **用户可达的停止入口**（此前全系统没有任何 stop 端点，抑制窗/级联/结算整条链在产品层不可达）：
   `POST /api/workspaces/{id}/stop`（routes/workspace.ts）→ 本进程 `runtime.abort()`（武装本进程抑制窗 + 结算 bash + 拒绝挂起的审批）+ Redis 停止信号（`maximilian:workspace:stop`，packages/queue/src/stop-signal.ts）→ worker 订阅后 abort 自己的 runtime（武装 worker 侧抑制窗）。
2. **机械派发全部标记 `autoResume: true`**：worker 主处理器、jobs-materialize、dags-flow、demo——命中抑制窗时 `AutoResumeSuppressedError` 结构化跳过（不标 failed、不再抛给 BullMQ 重试，避免与用户的 stop 对抗）；worker 处理器在 reset-to-planning 前还有 `checkAutoResume()` 预检，防止重试路径先把刚停止的工作区重置。
3. **崩溃恢复扫描**：worker 启动时 `recoverStalledJobs` 扫 `listStalledRunning()`（FileWorkspaceStore 与 PgWorkspaceStore 双实现）——transient/rate_limit 重置回 planning 并重新入队（maxResets=20 熔断），permanent/context_limit/cancelled 注记 hold（幂等），unknown 只计数。
4. **审计账本消费者**：api 实例化 `<WORKSPACE_DIR>/audit/audit-ledger.jsonl`——permission allow 答复、远程门 release、workspace stop、shadow commit/rollback 全部入账；`GET /api/audit/verify` 验链（admin）。
5. **shadow-commit 消费者**：applyPromotion（文件存储分支）在覆盖 live blueprint 前快照（非 git 目录 best-effort 跳过；Pg 分支由数据库事务历史兜底，无需文件快照）；`GET/POST /api/audit/shadow[/rollback]` 提供运营回滚入口。
6. **写安全协调器消费者**：FileWorkspaceStore.saveWorkspace 以按 id 写租约串行化同工作区的并发保存（修复 tenant 键与 ws 键跨保存交错的跨租户读取竞态；异 id 并行不受阻）。

## 诚实边界

- minimax 的停止传播/结算语义按 Maximilian 的 runtime 任务模型重写，非逐行移植。
- goal-judge 本体接口注入，LLM judge 接线留待后续；当前为确定性 fallback。
- 哈希链只保证"检测篡改/截断"，不防持有文件系统写权限的攻击者重写整链。
- Redis pub/sub 的停止信号是 at-least-once 尽力投递：极端情况下信号丢失，运行会自然跑完（抑制窗与队列预检仍是队列/cron 路径上的正确性兜底）。
- 写安全协调器是进程内互斥；api 与 worker 两进程对同一文件的并发写不在其防护范围（Pg 部署下工作区状态本就由数据库事务保护）。

---

## 2026-10-13 追加波次（dd0a7bf + 529aad6）：2026-10 上游调研池第一二梯队

21 个有更新参考仓逐仓调研（六份调研报告，每份含"排查过但排除"清单）后的全量落地。
4 个并行代理 + 主线收尾（代理在收尾阶段撞 5 小时限额，中间态 91 文件由主线验证、补缺、集成）。

### 执行链（minimax / opencode / crewAI / swarms / agency-swarm）

| 项                                                                                     | 落点                                                          |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| oversized 确定性分类 + 单次强制压缩恢复（恢复走 before-LLM 管线内 hook，二次拒绝即终） | `packages/core` error-taxonomy + tool-integration             |
| reminder 注入判定（压缩边界向前扫描）+ 单一所有者                                      | `packages/core` reminder                                      |
| uncalled 工具调用终态收口（input-incomplete 引导重发）                                 | `packages/core` tool-integration                              |
| exec 超时分块（>2^31-1ms 定时器钳制）                                                  | `packages/core` scheduleTimeoutChunks                         |
| LLM 流看门狗（首事件/空闲，retryable 超时非 abort）                                    | `packages/llm` stream-watchdog（providers 消费）              |
| 能力谓词关闸 + 客户端 stop-word 兜底                                                   | `packages/providers` capability-predicates（gemini 格式应用） |
| 错误优先于部分输出残留的采集不变式                                                     | `packages/core` goal-final-reply errorFirstReply              |

### 持久化与调度（pi / hermes / openclaw / deepseek）

| 项                                                 | 落点                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------- |
| 孤儿工具对剥离净化器（可扩展类型表）               | `packages/session-store` message-sanitizer                            |
| hydration 失效整体重读+重校验                      | `packages/session-store` hydration-retry                              |
| documentRetention 有界缓存（retention=0 双跑护栏） | `packages/session-store` retention-cache                              |
| display-only 提交绕过执行队列（reset 例外）        | `packages/session-store` submission-admission                         |
| 恢复簿记按 live work 有界化                        | `packages/queue` ownership-index + crash-recovery                     |
| cron 存储降级状态机 + outage 错过补火              | `packages/queue` cron-outage                                          |
| 瞬态重试 pending 抑制告警；取消≠失败               | `packages/autonomy` cron-notifications                                |
| 代理对安全截断                                     | `packages/core` text-safe → tool-extensions 预览 + session-store 标题 |

### 客户端面（cc-switch / opencode / OpenHands）

| 项                                                             | 落点                                      |
| -------------------------------------------------------------- | ----------------------------------------- |
| 孤儿工具结果降级标记 user 消息（共享 marker + 回合边界 flush） | `packages/compat-shims` tool-results      |
| 单编码事件流 + 每连接有界队列（溢出只杀该连接）                | `apps/api` event-feed                     |
| 入站死信层（minAge + 非重试分类器 + 保留上限）                 | `apps/api` inbound-dead-letter            |
| diff-first 审批门（可选证据只收紧）                            | `apps/api` remote-approval-gate evidence  |
| 认证头由上游协议决定                                           | `packages/compat-shims` llm               |
| 防抖持久化卸载语义（清除胜过挂起写）                           | `packages/ui-state` debounced-persistence |

### 自进化安全与 CI 门（agentos / conductor / cbm-mcp / hermes）

| 项                                                                                  | 落点                                                      |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------- |
| StepGate：伪造工作流步骤过直调同款闸门（副作用白名单链/STEP_REPLACED/cycle/深度≤8） | `packages/workflow-engine` step-gate                      |
| 模板表达式线性扫描 + 深度门 32（差分对拍测试）                                      | `packages/workflow-engine` expr（dags/meta-system 消费）  |
| 能力族注册表：名字与门同源；未审计降级行而非禁用                                    | `packages/evolution` ship-gates + 审计协议文档            |
| prompt 表面快照门（5 表面 12 fixture）                                              | `scripts/prompt-surface.ts` + `pnpm prompt-surface:check` |
| docs-drift 棘轮（基线只拦新增）                                                     | `scripts/check-docs-drift.ts` + `pnpm docs:drift:check`   |

### 主线收尾（代理限额中断后）

- **修复真实 survival bug**：`PgWorkspaceStore` 完全没有持久化 metadata——goalJudgement、recoveryHold、jobId 溯源在 Pg 部署下每次保存即毁。schema 加列 + 迁移 0005（幂等 ADD COLUMN IF NOT EXISTS）+ 读写两侧 + 门控集成测试（oh-my-claudecode be5e87f7d 教训的现实案例）。
- text-safe 消费方接线（tool-extensions head/tail 预览、session 标题推导本地副本）。
- 两个 store 的 metadata survival 契约测试。
- docs-alignment 卫兵（`pnpm docs:alignment:check`）——首跑抓到 6 条存量悬空链接并修复。
- viability 评估 prompt + 绑定决策记录格式（`docs/viability-assessment.md`，Kosmos）。
- CI 两轮依赖审计修复：@grpc/grpc-js（上轮）与本轮 shell-quote（GHSA-pqg4-j6r4-53mv critical，override ^1.11.0）。

### 剩余池（批 3，低/缓优先级，待后续波次）

dsh timed ask_user 两次结算；token-monitor 子代理 parent-link；agentos 能力中介+QuickJS；agentos guardedFetch SSRF 集；不可信文档 worker 解析；hermes 豁免过期/压缩 per-attempt 遥测/租约刷新三边界/git index.lock 回收/fire 启动门；dsh 子代理本地失败日志偏移；OpenHands goal Resume 判最新；cc-switch 模型拉取 seq guard 与选择对话框；opencode 目录消失归档 sweep；crewAI 前缀 id 校验先行/stop 封闭原因枚举；ZCode run 一世时长推导；grok trace 双测试；wshobson 技能评测/gardener lint；opencode-workspace 退役公告格式；agentos outbox；cbm 最优优先预算准入；minimax TPS 突发剔除。

### 新增配置键

无（本波全部为模块级默认行为或代码内常量，未引入新环境开关）。

### 诚实边界

- StepGate 审批接线复用现有 permission 面，链式副作用白名单默认为空（`Config` 未暴露）——启用即收紧，符合"门只收紧"方向。
- prompt-surface 快照门当前覆盖 agents 包默认角色面（5 表面）；新角色/工具注册后需 `pnpm prompt-surface:update` 再生。
- retention-cache 目前由 session-store 投影消费；queue 侧长驻缓存的接入留待批 3。
- 批 3 池（上表）尚未落地。

---

## 2026-11-13 波次：deepseek-ai/chat-demo（官方，387⭐，MIT，~14.6k 行）

来源侦察：用户点名仓库；克隆至 `../chat-demo`（只读参考）。纯前端静态聊天应用
（浏览器直连 DeepSeek API，Anthropic 兼容协议 + IndexedDB + ZIP 档案），客户端
会话编排层工程密度极高。移植 ~1.3k 行进 5 个包，提交 52d5cfa，CI 绿。

### 条目与落点

| 上游机制                                                                | 移植落点                                                                                    | 消费者                                                                       | 测试                                    |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------- |
| branches.ts 消息树（normalize/可见路径/挂分支/切版本/版本列表引用稳定） | session-store `message-tree.ts` + 迁移 v3→v4（parent_id/selected_child_id）                 | api sessions 路由 + dashboard SessionsPanel 版本切换                         | 13（树不变量/软删除兼容/迁移幂等）      |
| history/ 档案协议（manifest 首条目+版本门、fail-fast、串行队列）        | session-store `backup.ts`（fflate STORE；单 BEGIN IMMEDIATE 替代 IndexedDB 暂存——事务更强） | GET /sessions/backup + POST /sessions/restore + SessionsPanel 导入导出       | 12（roundtrip/版本拒收/原子替换）       |
| sse.ts WHATWG 解码器                                                    | llm `sse-decoder.ts`（逐行）                                                                | gemini-native stream() + dashboard openWorkspaceStream                       | 24 差分（281 切分点）+ 4 providers 回归 |
| reply.ts refusal 结算 + 续写资格                                        | core `refusal.ts` + providers 三格式 finishReason 映射                                      | runToolLoop 终态、Result.metadata.refused、task-complete、review bundle 标注 | 44（映射/循环终止/落盘/标注）           |
| latestReminder + appendReminder 去重                                    | core `context-anchor.ts`（五项环境快照，可注入）                                            | runToolLoop 每轮变更才注入                                                   | 13（去重语义/注入次数）                 |
| store.ts rAF 合帧 + visibilitychange/pagehide flush                     | ui-react `streaming-flush.ts`                                                               | App.tsx 流路径（控制事件同步、delta 合帧、token 过滤）                       | 14（jsdom rAF/hidden flush）            |
| sessionGroups.ts 时间分组                                               | ui-react `session-groups.ts`                                                                | SessionsPanel 分组标题 + sessions.*.json locale                              | 6                                       |

### 主线集成发现（比借鉴本身更大）

**zod-openapi 3-arg 注册 bug（生产级，2026-09-07 e39ebf9 起存量）**：
`openapi(route, handler, hook)` 只有两个 handler 位——第三个位置参数是校验**失败**
hook。99 处 `api.openapi(route, requireAuthMiddleware(), handler)` 把 auth 塞进
handler 槽、真 handler 塞进 hook 槽：带校验的路由真 handler 从未执行（unauth 500
而非 401）。0.18 与 1.6.3 签名相同，与 zod 4 迁移无关；两个月未被发现是因为所有
测试都用 2-arg 注册、e2e 全 mock。修复 = `withMiddleware()` 把 auth 放
route.middleware（执行序先于 validators），实测 unauth 401 / admin 200。

其他集成结论：

- node_modules 陈旧 peer 符号链接（zod 4 迁移前建的 resolvers 链接存活）会让
  dashboard tsc 假红；`pnpm install --frozen-lockfile --force` 重链即愈，非代码问题。
- `useThrottledMarkdown` 移植后无消费面（dashboard 无流式 markdown 组件），按
  死代码纪律删除；机制记录在案，未来有消费面时从 chat-demo 重取。

### 诚实边界（机制无宿主面，勿重开）

- **删除竞态防护（removeSession/settle 复活、deletionTasks、waitForIdle）**：
  workspace 无删除路由、store 无删除方法——竞态不存在。
- **historyEpoch**：无可失效的进程内会话缓存（store 每请求直读）；restore 的
  原子性由 SQLite 单事务承担。
- **describe.ts notice 分类 + i18n key 持久化**：core `ERROR_CATALOG` 已有
  remediation/retryable 分类层，整块移植会成为第二套重叠分类法。
- **parseEvent 未识别事件丢弃**：message-sanitizer（存量）+ 新 decoder 字段校验
  已覆盖。
- **附件 file_id 失效自愈**：无附件管线（同 planImageEviction 降级）。

量级：上游 14.6k 行 vs 移植 ~1.3k 行（≈11:1；缺口=宿主 UI 面、IndexedDB→SQLite
事务替代、语音/搜索 UI 无对应物）。

---

## 2026-11-14 波次：MiniMax-AI 全组织（minimax-org/ 11 仓 + minimax-code 增量）

背景：45 参考仓全量更新（17 仓有更新）；MiniMax-AI 组织除模型论文仓外的基础设施
仓全部克隆分析（Mini-Agent、OpenAgentCore、mcode-stack、MiniApps、Plugins、
MCP-JS、mcode-agent-table、Provider-Verifier、minimax_search、cli）。四组并行
研究 + 主线抽查核实后实施，提交 67c0bfb（+8c32ec0 gitleaks 夹具 allowlist），
release 1.4.0。全量 30 包 5220 测试 0 失败。

### P1（三处真缺陷 + 三处补缺）

| 机制                                                                                                  | 来源                      | 落点/消费者                                                                                              |
| ----------------------------------------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------- |
| 执行槽位饥饿：parked 审批占 BullMQ 槽最长 10 分钟，3 个即饿死并发                                     | OAC worker.go:277         | worker `park-yield.ts`（park 边沿让槽、resolve 续跑同 continuation 零重跑；PARK_YIELD_ENABLED 默认开）   |
| event-log 撕裂追加：appendLocked 不查尾部，崩溃撕裂行被粘接→SSE 重放丢事件                            | mcode-agent-table b00862b | api `event-log.ts` classifyTail（字节级）+ 单 fd + ftruncate 回滚 + 未应用条目拒追加；上游 12 例矩阵移植 |
| 出站错误脱敏：test-chat 探针原文回传 err.message（SDK 401 回显密钥）                                  | minimax-code 9a93560      | providers `redact.ts`（契约导出）+ api system.ts/jobs.ts 接线                                            |
| 后台 shell 注册表：run_in_background/bash_output 游标/bash_kill                                       | Mini-Agent bash_tool.py   | tools `bash-background.ts`/`bash-output.ts`，BUILTIN_TOOLS 注册                                          |
| Usage 自洽门：cached≤input、total=sum，不一致按未知不入账                                             | OAC usage.go              | providers `usage.ts` measuredUsage/gateUsageShape                                                        |
| 评测三件：validator 注册表 / tool_calls 四格混淆矩阵+schema 准确率 / 对基线 F1 漂移（接 truth-audit） | Provider-Verifier         | benchmark-core validators/* + evolution flip-matrix + cli 对比表                                         |

### P2 机制

- **runtime**：provider bundle 按 run 冻结；权限活开关（每次调用重读 live scopes，
  fail-closed）；event-sourcing 终局保留位（terminal 事件不受限额剪除）；主动双
  信号压缩 + 分轮 LLM 摘要（Mini-Agent；无 summarizer 退化截断）。
- **providers**：错误体感知分类（厂商码/trace-id/retryable verdict）+ anthropic
  流式 usage 采集（主线自查发现缺失）+ 能力单点声明（准入+只窄不宽）。
- **api**：SSE 鉴权重查+慢读者断连；幂等键重放+同 key 异 body 409；duplicate
  JSON key 400 带 path（boot 冒烟实测）。
- **evolution**：taste-to-checks 教训漏斗（重复纠正→check-proposal）；promote 噪
  声校准（非确定性 judge 基线双跑）+ 预算门；workflow 声明-实际一致性 lint；judge
  证据强制条款。

### 主线集成发现（上一波的死缝）

**contextOverflowRecovery 从未接线**：2026-10-13 波的"强制压缩恢复"只落了
tool-integration 的 option 与 compaction.ts 原语，**没有任何 host 传过该回调**
（runtime.ts 注释写着 "via hosts wiring" 但无人接）——生产上该恢复路径不可达。
本轮补线：runtime 默认 `defaultContextOverflowRecovery()`（强制压到一半，
system+真实 user 意图 verbatim 保留——无摘要器时截断路径会吞任务指令，已修）+
`defaultProactiveCompaction()`（chars/4 估算、120k 天花板）。

### 诚实边界（无宿主面/已有对应物，勿重开）

agent-table 拓扑即策略（无多代理讨论面，框架勿先建）；插件注册表整线
（PluginManager 本身悬空）；MCP server 托管/媒体生成/iframe 宿主/WS 网关/
Vault 加密行/沙箱挂起；cron/Feishu 特化链。存照待清理：`PluginManager`、
`scopeForbidsPath`、`terminal_title_toggle` keybind 三处疑似悬空件。

### 教训

- 上游"协议规格类文档"（MiniApps package-contract、OAC contracts/*.md）是最优质
  的借鉴来源——语义边界写得比代码还清楚。
- 借鉴落地后必须核对"option 有没有 caller"：连续两波（compaction 恢复、本轮差
  点重演）都出现"机制完整但无人传参"的准死代码。
