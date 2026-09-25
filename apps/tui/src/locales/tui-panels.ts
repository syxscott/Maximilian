/**
 * TUI panel-domain i18n strings + runtime dictionary merge.
 *
 * The core dictionaries live in `@max/i18n` (packages/i18n) and are shared
 * with the dashboard. Panel domains keep their strings HERE (apps/tui/src,
 * which is this feature's file ownership) and merge them over the core
 * dictionaries at import time — the same pattern as the dashboard's
 * `src/lib/i18n-merge.ts`, minus the JSON files (the TUI has no aggregator,
 * so a typed TS module is simpler and keeps keys greppable).
 *
 * Keys are flat with the TUI's existing `tui.` prefix so they can later be
 * promoted into packages/i18n verbatim. Locales without a translation below
 * get the English subtree (never a raw key, never a console.warn).
 */

import { getDictionary, listLocales, localeDisplayName, registerLocale } from "@max/i18n"

type Dict = Record<string, string>

const en: Dict = {
  // ── Jobs dialog ──────────────────────────────────────────────────────────
  "tui.jobs": "Jobs",
  "tui.jobs.loading": "Loading jobs…",
  "tui.jobs.empty": "No scheduled jobs.",
  "tui.jobs.error": "Failed to load jobs: {error}",
  "tui.jobs.hints": "j/k move · Enter details · d delete · t trigger · r refresh · esc close",
  "tui.jobs.details": "details",
  "tui.jobs.payload": "payload",
  "tui.jobs.payload.workspace": "workspace dispatch",
  "tui.jobs.payloadNone": "none (record-only)",
  "tui.jobs.payloadLegacy": "legacy record-only",
  "tui.jobs.payloadUnknown": "unknown",
  "tui.jobs.nextRun": "next run",
  "tui.jobs.lastTriggered": "last trigger",
  "tui.jobs.triggerCount": "fires",
  "tui.jobs.recentEvents": "recent events",
  "tui.jobs.confirmDelete": "Press d again to delete {name}",
  "tui.jobs.deleted": "Job {name} deleted",
  "tui.jobs.deleteFailed": "Delete failed: {error}",
  "tui.jobs.triggered": "Job {name} triggered",
  "tui.jobs.triggerFailed": "Trigger failed: {error}",
  "tui.jobs.status.armed": "armed",
  "tui.jobs.status.stalled": "stalled",
  "tui.jobs.status.idle": "idle",
  "tui.jobs.never": "never",
  "tui.jobs.every": "every {interval}",
  "tui.jobs.estimate": "next fire",
  "tui.jobs.estimate.cron": "cron — exact time not computed",
  "tui.jobs.refreshAgo": "updated {seconds}s ago · r refresh",
  "tui.jobs.event.scheduled-trigger": "scheduled",
  "tui.jobs.event.manual-trigger": "manual",
  "tui.jobs.event.dispatched": "dispatched",
  "tui.jobs.event.dispatch-failed": "dispatch failed",
  "tui.jobs.event.materialized": "materialized",
  "tui.jobs.event.unknown": "unknown",
  // ── Goals panel ──────────────────────────────────────────────────────────
  "tui.goals": "Goals",
  "tui.goals.loading": "Loading goals…",
  "tui.goals.error": "Failed to load goals: {error}",
  "tui.goals.empty": "No workspace runs yet — send a prompt to start one.",
  "tui.goals.noRequest": "(no request recorded)",
  "tui.goals.progress": "{percent}% · {completed}/{total} tasks done · {failed} failed",
  "tui.goals.milestone.plan": "plan",
  "tui.goals.milestone.execution": "execution",
  "tui.goals.milestone.review": "review",
  "tui.goals.reviewScore": "review score {score}",
  "tui.goals.sources": "derived from: {sources}",
  "tui.goals.dependsOn": "depends: {deps}",
  "tui.goals.failedSummary": "{count} failed: {labels}",
  "tui.goals.hints": "r refresh · esc close",
  // ── Usage panel ──────────────────────────────────────────────────────────
  "tui.usage": "Usage",
  "tui.usage.loading": "Loading usage…",
  "tui.usage.error": "Failed to load usage: {error}",
  "tui.usage.requests": "requests",
  "tui.usage.tokens": "tokens",
  "tui.usage.cost": "cost",
  "tui.usage.cacheHitRate": "cache hit",
  "tui.usage.unpriced": "unpriced requests: {count}",
  // ── Agents panel (evolution domain) ───────────────────────────────────────
  "tui.agents": "Agents",
  "tui.agents.loading": "Loading agent profiles…",
  "tui.agents.empty": "No agent profiles yet — run a task to evolve one.",
  "tui.agents.error": "Failed to load agents: {error}",
  "tui.agents.hints": "j/k move · Enter details · r refresh · esc close",
  "tui.agents.refreshAgo": "updated {seconds}s ago · r refresh",
  "tui.agents.tasks": "{count} tasks",
  "tui.agents.unrated": "unrated",
  "tui.agents.detail.memory": "memory buckets",
  "tui.agents.detail.memoryTotal": "{count} entries",
  "tui.agents.detail.versions": "versions",
  "tui.agents.detail.versionHistory": "({versions})",
  "tui.agents.detail.recentScores": "recent review scores",
  "tui.agents.detail.promotions": "version promotions",
  "tui.agents.noScores": "no review decisions recorded yet",
  "tui.agents.noLeaderboard": "no leaderboard entries yet",
  "tui.agents.bucket.userFeedback": "user feedback",
  "tui.agents.bucket.reviewSuggestions": "review suggestions",
  "tui.agents.bucket.commonErrors": "common errors",
  "tui.agents.bucket.goodExamples": "good examples",
  // ── Cron panel (cron-scheduled jobs) ──────────────────────────────────────
  "tui.cron": "Cron",
  "tui.cron.loading": "Loading cron jobs…",
  "tui.cron.empty": "No cron-scheduled jobs — press c to create one.",
  "tui.cron.error": "Failed to load jobs: {error}",
  "tui.cron.hints": "j/k move · c create · d delete · r refresh · esc close",
  "tui.cron.lastTriggered": "last trigger",
  "tui.cron.never": "never",
  "tui.cron.confirmDelete": "Press d again to delete {name}",
  "tui.cron.deleted": "Job {name} deleted",
  "tui.cron.deleteFailed": "Delete failed: {error}",
  "tui.cron.created": "Cron job {name} created",
  "tui.cron.createFailed": "Create failed: {error}",
  "tui.cron.create.title": "New cron job",
  "tui.cron.create.name": "Name:",
  "tui.cron.create.schedule": "Cron expression (5 fields):",
  "tui.cron.create.message": "Message:",
  "tui.cron.create.hint": "e.g. 0 9 * * * = daily 9am · Enter next · Backspace on empty goes back",
  "tui.cron.field.minute": "minute field",
  "tui.cron.field.hour": "hour field",
  "tui.cron.field.dayOfMonth": "day-of-month field",
  "tui.cron.field.month": "month field",
  "tui.cron.field.dayOfWeek": "day-of-week field",
  // ── Memory panel (per-role memory explorer) ───────────────────────────────
  "tui.memory": "Memory",
  "tui.memory.loading": "Loading agent profiles…",
  "tui.memory.empty": "No agent profiles yet — run a task to evolve one.",
  "tui.memory.error": "Failed to load agents: {error}",
  "tui.memory.roleVanished": "Profile gone — press r to refresh.",
  "tui.memory.emptyBucket": "(empty)",
  "tui.memory.emptyContent": "(no content)",
  "tui.memory.hints.roles": "j/k move · Enter open · r refresh · esc close",
  "tui.memory.hints.role": "j/k move · Enter expand · b roles · e export · r refresh · esc close",
  "tui.memory.bucket.userFeedback": "user feedback",
  "tui.memory.bucket.reviewSuggestions": "review suggestions",
  "tui.memory.bucket.commonErrors": "common errors",
  "tui.memory.bucket.goodExamples": "good examples",
  "tui.memory.efficacy": "efficacy ledger",
  "tui.memory.efficacy.rule": "gate: skip when mean < -{eps} over ≥ {samples} samples",
  "tui.memory.efficacy.injected": "injected {count}",
  "tui.memory.gating.skip": "gated",
  "tui.memory.gating.inject": "inject",
  "tui.memory.gating.unsampled": "inject · unsampled",
  "tui.memory.noEfficacy": "no efficacy records yet",
  "tui.memory.exported": "Memory JSON for {role} copied to clipboard ({bytes} bytes)",
  "tui.memory.exportFailed": "Export failed: {error}",
  "tui.memory.exportUnavailable": "clipboard unavailable",
  // ── Relative-time units (model layer outputs compact units) ──────────────
  "tui.relative.now": "just now",
  "tui.relative.ago": "{value}{unit} ago",
}

const zh: Dict = {
  // ── Jobs 对话框 ──────────────────────────────────────────────────────────
  "tui.jobs": "任务",
  "tui.jobs.loading": "正在加载任务…",
  "tui.jobs.empty": "暂无计划任务。",
  "tui.jobs.error": "加载任务失败：{error}",
  "tui.jobs.hints": "j/k 移动 · Enter 详情 · d 删除 · t 触发 · r 刷新 · esc 关闭",
  "tui.jobs.details": "详情",
  "tui.jobs.payload": "负载",
  "tui.jobs.payload.workspace": "工作区分发",
  "tui.jobs.payloadNone": "无（仅记录）",
  "tui.jobs.payloadLegacy": "旧版仅记录",
  "tui.jobs.payloadUnknown": "未知",
  "tui.jobs.nextRun": "下次运行",
  "tui.jobs.lastTriggered": "上次触发",
  "tui.jobs.triggerCount": "触发次数",
  "tui.jobs.recentEvents": "最近事件",
  "tui.jobs.confirmDelete": "再按一次 d 删除 {name}",
  "tui.jobs.deleted": "任务 {name} 已删除",
  "tui.jobs.deleteFailed": "删除失败：{error}",
  "tui.jobs.triggered": "任务 {name} 已触发",
  "tui.jobs.triggerFailed": "触发失败：{error}",
  "tui.jobs.status.armed": "已就绪",
  "tui.jobs.status.stalled": "已卡住",
  "tui.jobs.status.idle": "空闲",
  "tui.jobs.never": "从未",
  "tui.jobs.every": "每 {interval}",
  "tui.jobs.estimate": "下次触发",
  "tui.jobs.estimate.cron": "cron——不推算具体时间",
  "tui.jobs.refreshAgo": "已更新 {seconds} 秒前 · r 刷新",
  "tui.jobs.event.scheduled-trigger": "计划触发",
  "tui.jobs.event.manual-trigger": "手动触发",
  "tui.jobs.event.dispatched": "已分发",
  "tui.jobs.event.dispatch-failed": "分发失败",
  "tui.jobs.event.materialized": "已实体化",
  "tui.jobs.event.unknown": "未知",
  // ── Goals 面板 ───────────────────────────────────────────────────────────
  "tui.goals": "目标",
  "tui.goals.loading": "正在加载目标…",
  "tui.goals.error": "加载目标失败：{error}",
  "tui.goals.empty": "还没有工作区运行——先发送一个提示词吧。",
  "tui.goals.noRequest": "（未记录请求）",
  "tui.goals.progress": "{percent}% · 已完成 {completed}/{total} 个任务 · {failed} 个失败",
  "tui.goals.milestone.plan": "计划",
  "tui.goals.milestone.execution": "执行",
  "tui.goals.milestone.review": "评审",
  "tui.goals.reviewScore": "评审得分 {score}",
  "tui.goals.sources": "派生自：{sources}",
  "tui.goals.dependsOn": "依赖：{deps}",
  "tui.goals.failedSummary": "{count} 个失败：{labels}",
  "tui.goals.hints": "r 刷新 · esc 关闭",
  // ── Usage 面板 ───────────────────────────────────────────────────────────
  "tui.usage": "用量",
  "tui.usage.loading": "正在加载用量…",
  "tui.usage.error": "加载用量失败：{error}",
  "tui.usage.requests": "请求数",
  "tui.usage.tokens": "令牌数",
  "tui.usage.cost": "费用",
  "tui.usage.cacheHitRate": "缓存命中",
  "tui.usage.unpriced": "未计价请求：{count}",
  // ── Agents 面板（evolution 域）────────────────────────────────────────────
  "tui.agents": "角色",
  "tui.agents.loading": "正在加载角色档案…",
  "tui.agents.empty": "还没有角色档案——先运行一个任务来进化。",
  "tui.agents.error": "加载角色失败：{error}",
  "tui.agents.hints": "j/k 移动 · Enter 详情 · r 刷新 · esc 关闭",
  "tui.agents.refreshAgo": "已更新 {seconds} 秒前 · r 刷新",
  "tui.agents.tasks": "{count} 个任务",
  "tui.agents.unrated": "未评级",
  "tui.agents.detail.memory": "记忆桶",
  "tui.agents.detail.memoryTotal": "共 {count} 条",
  "tui.agents.detail.versions": "版本",
  "tui.agents.detail.versionHistory": "（{versions}）",
  "tui.agents.detail.recentScores": "最近评审分数",
  "tui.agents.detail.promotions": "版本晋升",
  "tui.agents.noScores": "还没有评审决策记录",
  "tui.agents.noLeaderboard": "排行榜暂无条目",
  "tui.agents.bucket.userFeedback": "用户反馈",
  "tui.agents.bucket.reviewSuggestions": "评审建议",
  "tui.agents.bucket.commonErrors": "常见错误",
  "tui.agents.bucket.goodExamples": "优秀示例",
  // ── Cron 面板（cron 计划任务）─────────────────────────────────────────────
  "tui.cron": "定时",
  "tui.cron.loading": "正在加载定时任务…",
  "tui.cron.empty": "暂无 cron 计划任务——按 c 创建一个。",
  "tui.cron.error": "加载任务失败：{error}",
  "tui.cron.hints": "j/k 移动 · c 创建 · d 删除 · r 刷新 · esc 关闭",
  "tui.cron.lastTriggered": "上次触发",
  "tui.cron.never": "从未",
  "tui.cron.confirmDelete": "再按一次 d 删除 {name}",
  "tui.cron.deleted": "任务 {name} 已删除",
  "tui.cron.deleteFailed": "删除失败：{error}",
  "tui.cron.created": "定时任务 {name} 已创建",
  "tui.cron.createFailed": "创建失败：{error}",
  "tui.cron.create.title": "新建定时任务",
  "tui.cron.create.name": "名称：",
  "tui.cron.create.schedule": "Cron 表达式（5 段）：",
  "tui.cron.create.message": "消息：",
  "tui.cron.create.hint": "如 0 9 * * * = 每天 9 点 · Enter 下一步 · 空字段按退格返回",
  "tui.cron.field.minute": "分钟段",
  "tui.cron.field.hour": "小时段",
  "tui.cron.field.dayOfMonth": "日段",
  "tui.cron.field.month": "月段",
  "tui.cron.field.dayOfWeek": "星期段",
  // ── Memory 面板（角色记忆查看器）──────────────────────────────────────────
  "tui.memory": "记忆",
  "tui.memory.loading": "正在加载角色档案…",
  "tui.memory.empty": "还没有角色档案——先运行一个任务来进化。",
  "tui.memory.error": "加载角色失败：{error}",
  "tui.memory.roleVanished": "档案已消失——按 r 刷新。",
  "tui.memory.emptyBucket": "（空）",
  "tui.memory.emptyContent": "（无内容）",
  "tui.memory.hints.roles": "j/k 移动 · Enter 打开 · r 刷新 · esc 关闭",
  "tui.memory.hints.role": "j/k 移动 · Enter 展开 · b 返回角色 · e 导出 · r 刷新 · esc 关闭",
  "tui.memory.bucket.userFeedback": "用户反馈",
  "tui.memory.bucket.reviewSuggestions": "评审建议",
  "tui.memory.bucket.commonErrors": "常见错误",
  "tui.memory.bucket.goodExamples": "优秀示例",
  "tui.memory.efficacy": "效力台账",
  "tui.memory.efficacy.rule": "门控：样本 ≥ {samples} 且 mean < -{eps} 时跳过",
  "tui.memory.efficacy.injected": "注入 {count} 次",
  "tui.memory.gating.skip": "已门控",
  "tui.memory.gating.inject": "注入",
  "tui.memory.gating.unsampled": "注入 · 样本不足",
  "tui.memory.noEfficacy": "还没有效力记录",
  "tui.memory.exported": "{role} 的记忆 JSON 已复制到剪贴板（{bytes} 字节）",
  "tui.memory.exportFailed": "导出失败：{error}",
  "tui.memory.exportUnavailable": "剪贴板不可用",
  // ── 相对时间单位（模型层输出紧凑单位）────────────────────────────────────
  "tui.relative.now": "刚刚",
  "tui.relative.ago": "{value}{unit}前",
}

/** Per-locale subtree; locales not listed here fall back to English. */
const BY_LOCALE: Record<string, Dict> = {
  "en-US": en,
  "zh-CN": zh,
}

/**
 * Merge the panel subtree over one locale's core dictionary and re-register
 * it. Keys are flat, so a spread IS the deep merge (the dashboard's
 * deepMerge handles nested trees; we don't need that generality here).
 */
function mergeInto(locale: string): void {
  const core = getDictionary(locale) ?? {}
  const override = BY_LOCALE[locale] ?? en
  registerLocale(locale, { ...core, ...override }, localeDisplayName(locale))
}

let registered = false

/** Idempotent: safe to call from every panel module's import side effect. */
export function registerTuiPanelStrings(): void {
  if (registered) return
  registered = true
  for (const locale of listLocales()) mergeInto(locale)
}

// Register before first render: every panel imports this module for the side
// effect, and panel modules are imported by app.tsx before `render()` runs.
registerTuiPanelStrings()
