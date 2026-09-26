// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Group renderers — execute-group / changes-group / cua-group. Each takes
 * its sub-calls from the passthrough input (items/calls, defensive) and
 * re-renders them recursively through ToolCallBlock, clamped to
 * GROUP_LIMIT with a "还有 N 个" overflow note. A summary stats row above
 * the children carries the outcome badges tallied by countOutcomes
 * (✓ ok / ✗ failed / unrecorded) and the mean sub-call duration from
 * avgDuration, humanized by the shell's humanizeDuration (hidden when no
 * child is timed). The count / average / overflow surfaces carry
 * locale-neutral data tooltips (shown/total, raw mean ms, the hidden
 * children's verbatim summaries — see hiddenSummaries). Nested group envelopes are
 * bounded by the model's MAX_GROUP_DEPTH: each level passes depth+1 to
 * its children and a body beyond the budget renders the depth note
 * instead of recursing.
 */

import { useLocale, t } from "@max/i18n"
import { ToolCallBlock, type ToolCallProps } from "../registry"
import { humanizeDuration, summarizeToolInput } from "../model"
import {
  avgDuration,
  countOutcomes,
  extractGroupChildren,
  GROUP_LIMIT,
  MAX_GROUP_DEPTH,
  withinGroupDepth,
  type GroupChild,
  type GroupKind,
} from "./group.model"
import { JsonFallback } from "./common"

const GROUP_TITLE_KEYS: Record<GroupKind, string> = {
  execute: "toolRenderers.execute-group.title",
  changes: "toolRenderers.changes-group.title",
  cua: "toolRenderers.cua-group.title",
}

/**
 * Tooltips for the summary row, following the shell's locale-neutral data
 * precedent (the collapsed duration's raw `${durationMs}ms` title, the
 * inline error's verbatim title): numbers and child data, no locale keys.
 *
 *   count    → "8/12" — how many of the total the clamp expands below
 *   avg      → the exact mean in raw milliseconds ("175ms"), the same
 *              raw-ms-within-tooltip contract as the shell duration
 *   overflow → one verbatim "tool · summary" line per hidden child
 *              (capped at 20), so "还有 N 个" names what is not shown
 */

/** Cap on the verbatim hidden-child lines carried by the overflow title. */
const OVERFLOW_TIP_LIMIT = 20

function hiddenSummaries(children: GroupChild[]): string {
  return children
    .slice(GROUP_LIMIT, GROUP_LIMIT + OVERFLOW_TIP_LIMIT)
    .map((child) => `${child.tool} · ${summarizeToolInput(child.tool, child.input)}`)
    .join("\n")
}

/** One outcome badge in the summary stats row (label carries the count). */
function OutcomeBadge({
  label,
  tone,
  testId,
}: {
  label: string
  tone: "ok" | "failed" | "unknown"
  testId: string
}) {
  const toneClass =
    tone === "ok"
      ? "border-secondary bg-secondary text-secondary-foreground"
      : tone === "failed"
        ? "border-destructive/40 bg-destructive/10 text-destructive"
        : "border-border/60 bg-transparent text-muted-foreground"
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 text-[10px] ${toneClass}`}
      data-testid={testId}
    >
      {tone === "ok" && <span aria-hidden="true">✓</span>}
      {tone === "failed" && <span aria-hidden="true">✗</span>}
      {label}
    </span>
  )
}

function GroupBodyBase({
  input,
  kind,
  depth = 0,
}: {
  input: unknown
  kind: GroupKind
  /** Nesting level of THIS body (top level = 0); parent groups pass depth+1. */
  depth?: number
}) {
  useLocale()
  if (!withinGroupDepth(depth)) {
    // Depth guard: a group envelope nested deeper than MAX_GROUP_DEPTH
    // renders the note instead of recursing through ToolCallBlock again.
    return (
      <div className="mt-1 space-y-1" data-testid="tool-body">
        <p className="text-[10px] text-muted-foreground" data-testid="tool-group-depth">
          {t("toolRenderers.group.depth", { depth: MAX_GROUP_DEPTH })}
        </p>
      </div>
    )
  }
  const { children, total, shown, overflow } = extractGroupChildren(input, kind)
  if (children.length === 0) return <JsonFallback input={input} />
  const { ok, failed, unknown } = countOutcomes(children)
  const avg = avgDuration(children)
  return (
    <div className="mt-1 space-y-1" data-testid="tool-body">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {t(GROUP_TITLE_KEYS[kind])}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <p
          className="text-[10px] uppercase text-muted-foreground"
          title={`${shown}/${total}`}
          data-testid="tool-group-count"
        >
          {t("toolRenderers.group.count", { count: total })}
        </p>
        <span className="flex items-center gap-1.5" data-testid="tool-group-outcomes">
          <OutcomeBadge
            label={t("toolRenderers.group.ok", { count: ok })}
            tone="ok"
            testId="tool-group-ok"
          />
          <OutcomeBadge
            label={t("toolRenderers.group.failed", { count: failed })}
            tone="failed"
            testId="tool-group-failed"
          />
          {unknown > 0 && (
            <OutcomeBadge
              label={t("toolRenderers.group.unknown", { count: unknown })}
              tone="unknown"
              testId="tool-group-unknown"
            />
          )}
        </span>
        {avg !== undefined && (
          <span
            className="text-[10px] text-muted-foreground"
            title={Number.isFinite(avg) ? `${Math.round(avg)}ms` : humanizeDuration(avg)}
            data-testid="tool-group-avg"
          >
            {/* Same humanization as the shell's collapsed duration (the
                {duration} slot carries humanizeDuration's "12.5s"/"2m5s"). */}
            {t("toolRenderers.group.avgDuration", { duration: humanizeDuration(avg) })}
          </span>
        )}
      </div>
      {children.slice(0, GROUP_LIMIT).map((child, i) => (
        <ToolCallBlock
          key={`${child.tool}-${i}`}
          tool={child.tool}
          input={child.input}
          ok={child.ok}
          durationMs={child.durationMs}
          error={child.error}
          depth={depth + 1}
        />
      ))}
      {overflow > 0 && (
        <p
          className="text-[10px] text-muted-foreground"
          title={hiddenSummaries(children)}
          data-testid="tool-group-more"
        >
          {t("toolRenderers.group.more", { count: overflow })}
        </p>
      )}
    </div>
  )
}

export const EXECUTE_GROUP_GLYPH = "⚙"

export function ExecuteGroupBody(props: ToolCallProps) {
  return <GroupBodyBase input={props.input} kind="execute" depth={props.depth} />
}

export const CHANGES_GROUP_GLYPH = "∆"

export function ChangesGroupBody(props: ToolCallProps) {
  return <GroupBodyBase input={props.input} kind="changes" depth={props.depth} />
}

export const CUA_GROUP_GLYPH = "▣"

export function CuaGroupBody(props: ToolCallProps) {
  return <GroupBodyBase input={props.input} kind="cua" depth={props.depth} />
}
