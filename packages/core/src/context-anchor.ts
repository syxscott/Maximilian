// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Env-anchor snapshots with change-dedup injection (deepseek chat-demo
 * latestReminder.ts + toRequestMessages appendReminder borrowing).
 *
 * chat-demo semantics being ported: every reply stores the environment
 * snapshot at that moment (date / weekday / location / platform / language);
 * when assembling a request, the snapshot is inserted as an anchor message
 * ONLY where it first appears or where its content changed — an unchanged
 * snapshot is never re-sent. The anchor stays fresh without burning tokens
 * every round.
 *
 * Maximilian mapping: the tool loop recomputes the snapshot before each LLM
 * round and pushes an anchor message into the live conversation only when
 * {@link shouldInjectAnchor} says the value is new or changed — long loops
 * that cross a day boundary or switch models refresh their anchor
 * automatically; short loops pay nothing after the first round.
 */

/**
 * The five Maximilian anchor fields (chat-demo's model-agreed five items,
 * adapted): local date, weekday, working directory (or workspace id), model
 * id, language/timezone.
 */
export interface EnvAnchorContext {
  /** Workspace id — used when no working directory is available. */
  workspaceId?: string
  /** Working directory; preferred over workspaceId as the location anchor. */
  cwd?: string
  /** Model id currently serving the loop. */
  modelId?: string
  /** Language/locale tag; when absent the timezone field stands in. */
  language?: string
}

/**
 * Injectable formatters (pure-function seam — tests inject deterministic
 * formatters instead of relying on the host clock/ICU).
 */
export interface EnvAnchorFormatters {
  /** Local date, e.g. "2026-11-14" (local time — never UTC, avoiding
   *  cross-day skew; chat-demo latestReminder.ts note). */
  date?: (now: Date) => string
  /** Weekday name, e.g. "Saturday". */
  weekday?: (now: Date) => string
  /** IANA timezone id, e.g. "Asia/Shanghai". */
  timezone?: (now: Date) => string
}

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const

const pad2 = (n: number): string => String(n).padStart(2, "0")

/** Default formatters — host-clock based, local time (never UTC). */
export const DEFAULT_ENV_ANCHOR_FORMATTERS: Required<EnvAnchorFormatters> = {
  date: (now) => `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`,
  weekday: (now) => WEEKDAY_NAMES[now.getDay()] ?? "Unknown",
  timezone: () => Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown-timezone",
}

/**
 * Build the comma-joined five-field snapshot string (chat-demo
 * latestReminder.ts joining convention). All formatters injectable; the
 * returned string is the dedup key AND the anchor payload.
 */
export function createEnvSnapshot(
  now: Date,
  context: EnvAnchorContext = {},
  formatters: EnvAnchorFormatters = {},
): string {
  const f = { ...DEFAULT_ENV_ANCHOR_FORMATTERS, ...formatters }
  const location = context.cwd ?? context.workspaceId ?? "unknown-workspace"
  return [
    f.date(now),
    f.weekday(now),
    location,
    context.modelId ?? "unknown-model",
    context.language ?? f.timezone(now),
  ].join(",")
}

/**
 * Dedup gate (chat-demo toRequestMessages appendReminder borrowing, verbatim
 * semantics): inject only when the snapshot is first appearing on this
 * branch or its content changed. An empty snapshot never injects.
 */
export function shouldInjectAnchor(previous: string | undefined, next: string): boolean {
  return next.length > 0 && next !== previous
}

/**
 * Render the anchor payload as a user-role message body with an explicit
 * environment-anchor annotation so the model can tell the anchor apart from
 * user-authored instructions.
 */
export function formatAnchorMessage(snapshot: string): string {
  return (
    `[environment anchor] Current environment snapshot (date, weekday, workspace, model, locale): ` +
    `${snapshot}. This anchor is injected only when the environment changed — treat it as the ` +
    `authoritative "now" for date/time, workspace, model, and locale questions.`
  )
}

/**
 * Default snapshot provider for the tool loop (closure over the host clock +
 * the loop's workspace/model context). Recomputed per call, so a loop that
 * crosses a day boundary produces a changed snapshot and the anchor
 * refreshes automatically.
 */
export function defaultEnvSnapshotProvider(
  context: EnvAnchorContext,
  formatters: EnvAnchorFormatters = {},
): () => string {
  return () => createEnvSnapshot(new Date(), context, formatters)
}
