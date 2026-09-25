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
 * (✓ ok / ✗ failed / unrecorded).
 */

import { useLocale, t } from "@max/i18n"
import { ToolCallBlock, type ToolCallProps } from "../registry"
import { countOutcomes, extractGroupChildren, GROUP_LIMIT, type GroupKind } from "./group.model"
import { JsonFallback } from "./common"

const GROUP_TITLE_KEYS: Record<GroupKind, string> = {
  execute: "toolRenderers.execute-group.title",
  changes: "toolRenderers.changes-group.title",
  cua: "toolRenderers.cua-group.title",
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

function GroupBodyBase({ input, kind }: { input: unknown; kind: GroupKind }) {
  useLocale()
  const { children, total, overflow } = extractGroupChildren(input, kind)
  if (children.length === 0) return <JsonFallback input={input} />
  const { ok, failed, unknown } = countOutcomes(children)
  return (
    <div className="mt-1 space-y-1" data-testid="tool-body">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {t(GROUP_TITLE_KEYS[kind])}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <p className="text-[10px] uppercase text-muted-foreground" data-testid="tool-group-count">
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
      </div>
      {children.slice(0, GROUP_LIMIT).map((child, i) => (
        <ToolCallBlock
          key={`${child.tool}-${i}`}
          tool={child.tool}
          input={child.input}
          ok={child.ok}
          durationMs={child.durationMs}
          error={child.error}
        />
      ))}
      {overflow > 0 && (
        <p className="text-[10px] text-muted-foreground" data-testid="tool-group-more">
          {t("toolRenderers.group.more", { count: overflow })}
        </p>
      )}
    </div>
  )
}

export const EXECUTE_GROUP_GLYPH = "⚙"

export function ExecuteGroupBody(props: ToolCallProps) {
  return <GroupBodyBase input={props.input} kind="execute" />
}

export const CHANGES_GROUP_GLYPH = "∆"

export function ChangesGroupBody(props: ToolCallProps) {
  return <GroupBodyBase input={props.input} kind="changes" />
}

export const CUA_GROUP_GLYPH = "▣"

export function CuaGroupBody(props: ToolCallProps) {
  return <GroupBodyBase input={props.input} kind="cua" />
}
