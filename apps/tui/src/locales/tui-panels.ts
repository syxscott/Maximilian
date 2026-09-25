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
  "tui.goals.hints": "r refresh · esc close",
  // ── Usage panel ──────────────────────────────────────────────────────────
  "tui.usage": "Usage",
  "tui.usage.loading": "Loading usage…",
  "tui.usage.error": "Failed to load usage: {error}",
  "tui.usage.requests": "requests",
  "tui.usage.tokens": "tokens",
  "tui.usage.cost": "cost",
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
  "tui.goals.hints": "r 刷新 · esc 关闭",
  // ── Usage 面板 ───────────────────────────────────────────────────────────
  "tui.usage": "用量",
  "tui.usage.loading": "正在加载用量…",
  "tui.usage.error": "加载用量失败：{error}",
  "tui.usage.requests": "请求数",
  "tui.usage.tokens": "令牌数",
  "tui.usage.cost": "费用",
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
