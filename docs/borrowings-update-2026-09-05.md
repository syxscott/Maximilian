---
## 九、实现记录(2026-09-05,已全部落地)

| #   | 借鉴项                                 | 实现                                                                                                                                                                                                                                                                                          | 新增测试                              |
  | --- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
  | 1   | sealed files + 形状契约 + lint         | `packages/evolution/src/sealed-files.ts`(SealedFileVault seal/verify/guard);`artifact-lint.ts`(incident-reference/chat-reference/references-sprawl/section-sprawl);constraint-gates 补实现 duplicate-section;`evolution.ts` 晋升前 lint;facade 可选 sealedVault                               | sealed-files(13) artifact-lint(13)    |
  | 2   | hermes 自进化三件套                    | `curator.ts`(pin/archive-not-delete/consolidate);`memory.ts` freeze() 冻结快照 + factory.ts 按 agent 实例冻结 prelude(prefix-cache 稳定);`reflection.ts` BackgroundReflector(反思 fork,串行、防火焰)+ facade.applyLessons(lint+去重后入 reviewSuggestions);recordCompletion 内联 curator 维护 | hermes-trio(19)                       |
  | 3   | 统一模型 catalog 三级加载              | `packages/providers/src/model-catalog.ts`(磁盘缓存 TTL→远端 models.dev 格式(跨进程锁)→内嵌 snapshot)+ `model-catalog-snapshot.ts`(24 模型,cost null=未知≠0,tier 推断)                                                                                                                         | model-catalog(16)                     |
  | 4   | 权限 always 追溯放行 + fail-closed     | `packages/tools/src/permission-service.ts`:always 批量追溯放行、reject 批量拒绝、allowed-once/cancelled、未知/超时→unavailable(fail-closed)、审计事件 + replay 重建策略                                                                                                                       | permission-service(10)                |
  | 5   | steer/followup 双队列 + 提示合并       | core `steering.ts`(pi 双队列原语);runtime `steer()/queueFollowup()/isExecuting()` + 波次边界注入 + followup-pending 事件;`prompt-queue.ts`(grok-build 合并规则+乐观 version edit);chat 路由 `workspaceId` steering 入口                                                                       | steering-prompt-queue(10)             |
  | 6   | retry UI 语义 + SSE 双超时             | `retry.ts` onRetryStatus(attempt/delay/action/nextRetryAt)+ describeRetryAction;`sse-guard.ts` guardSse(header/chunk 双 5min 超时,Promise.race 打断,上游 return() 传播取消)+ withSseGuard 接入 registry                                                                                       | retry-sse(9)                          |
  | 7   | dashboard UI 三件套                    | StatusDot 增 waiting(静止黄)/skipped(灰);theme.css 三层主题契约文档化;`DiffPreview.tsx` 审批卡内嵌 diff(edit/write),runtime permission-request 事件补 `input` 字段,App.tsx→api.ts 收口                                                                                                        | diff-preview(9)                       |
  | 8   | SDK 契约守护                           | `apps/api`:92 条路由快照 `openapi-paths.json` + contract:update 脚本 + 漂移测试;dashboard 架构守护测试(fetch/EventSource 只准走 api.ts,App.tsx 的 SSE 已收口)                                                                                                                                 | api-contract(2) arch-boundary(3)      |
  | 9   | PolicyDenied: deny≠故障                | core `policy-error.ts`(PolicyDeniedError + 序列化前缀);classifyTaskError 结构化优先分类 policy_denied;evolution 失败记忆/反思学习排除治理拒绝                                                                                                                                                 | policy-denied(9)                      |
  | 10  | 模型分层 tier + 锚定 rubric + 变异早停 | dags ModelAssigner 角色分层(frontier/standard/economy)写入 modelAssignment.tier;llm-judge RUBRIC_ANCHORS + rubricContext(triggerF1/orchestrationFitness/outputQuality/scopeCalibration);variant-runner patience 早停                                                                          | tier-rubric(6) model-assigner-tier(3) |
  | 11  | gateway 渠道接入 + 通知出站            | 新包 `packages/gateway`:ChannelAdapter 抽象、发件人信任分级(owner>trusted>known>unknown,fail-closed)、messageId 去重、优雅 drain;webhook/console 适配器;worker 完成事件出站(GATEWAY_WEBHOOK_URL)                                                                                              | gateway(11)                           |
  | 12  | 成本真实数据 + 窗口分档                | usage 汇总加 `totalCostUsdKnown`;新端点 `GET /api/obs/usage/windows`(5h/24h/7d/30d 滚动窗口,任一 unpriced 请求 → costUsd=null)                                                                                                                                                                | usage-windows(5)                      |

  回归结果:evolution 138、providers 134、tools 102、core 656、dags 36、gateway 11、api 214(+4 skip)、dashboard 115、worker 7 — 全部通过;各包 tsc 干净。
---

## 十、实现后复查(2026-09-05)

对全部新增/修改代码逐模块重读,发现并修复 5 个问题(均已补回归测试):

1. **PermissionService 审计 sink 的 unhandled rejection**(严重):`record()` 里 `void cb(event)` 只兜住了同步抛错;async sink reject 会成为 unhandled rejection,Node 20 默认直接崩进程。改为 `Promise.resolve().then(() => cb(event)).catch(() => {})`。
2. **ChatPromptQueue 单条失败炸掉调度器**(严重):`runOne` 对 `onRun` 的异常只有 try/finally 没有 catch,且以递归方式取下一条——handler 抛错会 reject 掉 fire-and-forget 的调度 Promise 并中断后续排队消息。改为循环调度 + 每条独立 try/catch + 可选 `onError` 回调。
3. **Curator 违反"pinned 免疫"**(边界):旧实现中两条 pinned 重复内容,较旧的那条 pinned 仍会被归档。重写 consolidate 决策:先按 key 选 canonical(pinned 优先),再分类,pinned 一律保留(免疫优先于去重,极端情况下允许并存)。
4. **EvolutionFacade profile 并发丢失窗口**(竞态):recordCompletion(任务热路径)与 applyLessons(后台反思)都对 profile 做读-改-写,交错的 await 会让后写的把先写的 memory 改动覆盖掉。新增 `profileTx` 串行化两个临界区(锁内无额外 await,无死锁风险)。
5. **artifact-lint 正则残渣**(清理):TRACKER_URL 里 `\blinking\b` 备选分支无意义且有误报可能,删除。

复查确认无误的点:sealed-files 的 glob 转义与 ** 通配;model-catalog 三级回退次序与跨进程锁的过期接管;withSseGuard 置于 retry 内层使 SSE 超时被识别为可重试网络错误(错误消息含 "timeout");runtime 波次 steering 注入只改 pending 任务、未消费消息按"陈旧 steering 优于丢失"原则在 finally 丢弃;policy_denied 分类保持与既有 permission_denied 字符串规则的兼容;chat 路由 steering 分支对队列模式/DAGS 模式工作区自然回退到原行为。

最终回归:evolution 139、providers 134、tools 103、core 657、dags 36、gateway 11、api 214(+4 skip)、dashboard 115、worker 7 — 全部通过;9 个 tsconfig 全部 0 错误。

---

## 十一、前端 UI 复查(2026-09-05)

对 apps/dashboard 逐组件排查,发现并修复 4 个 UI bug(均有测试覆盖):

1. **工作区加载可能整体失败(既有 bug,严重)**:dashboard 的 `PlanTaskSchema.status` 枚举缺后端 runtime 会真实返回的 `"skipped"` 与 `"cancelled"`。`fetchJson` 校验失败即抛错——工作区里只要出现一个 skipped 任务(依赖失败/终止时必然出现),整个工作区加载就报错。已对齐 @max/core 的 TaskStatus 枚举。
2. **状态语言断裂(既有 bug)**:AgentPanel 把 `skipped` 任务渲染成灰色 idle 点、TaskPanel 的 done 阶段列表给 skipped 任务打绿色 "✓"(看起来像成功)、STATUS_DOT 映射缺 skipped 档。统一接线:skipped = 空心灰点 + "–" 符号;新增 waiting = 静止琥珀点 + 左侧琥珀边条,由 App 把当前停在权限/审批门的 taskId 传入 AgentPanel。
3. **成本诚实语义没接到 UI**:API 返回的 `totalCostUsdKnown` 被 dashboard 的 zod schema 静默剥离。UsageSummarySchema 增补该字段;UsagePanel 在成本不可信时显示 "—" + 缺价请求数(红色警示卡);LiveUsagePill 同场景显示 "$—"。
4. **DiffPreview 硬编码英文 + 新文件标签误导**:组件接入 i18n(en/zh 各 6 个 key);write 全新文件头部显示"写入 · 新文件"而非误导性的 "1→N lines"。修复过程中还发现本项目 i18n 插值是**单花括号** `{name}`(新 key 若用 `{{name}}` 会渲染成 "{5}"),已按约定格式落地。

回归:dashboard 117 测试全过、tsc 0 错误;既有 115 测试无一破坏。
