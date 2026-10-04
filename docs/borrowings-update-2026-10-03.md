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
