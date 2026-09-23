// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Group renderers — execute-group / changes-group / cua-group. Each takes
 * its sub-calls from the passthrough input (items/calls, defensive) and
 * re-renders them recursively through ToolCallBlock, clamped to
 * GROUP_LIMIT with a "还有 N 个" overflow note.
 */

import { useLocale, t } from "@max/i18n"
import { ToolCallBlock, type ToolCallProps } from "../registry"
import { extractGroupChildren, GROUP_LIMIT, type GroupKind } from "./group.model"
import { JsonFallback } from "./common"

const GROUP_TITLE_KEYS: Record<GroupKind, string> = {
  execute: "toolRenderers.execute-group.title",
  changes: "toolRenderers.changes-group.title",
  cua: "toolRenderers.cua-group.title",
}

function GroupBodyBase({ input, kind }: { input: unknown; kind: GroupKind }) {
  useLocale()
  const { children, total, overflow } = extractGroupChildren(input, kind)
  if (children.length === 0) return <JsonFallback input={input} />
  return (
    <div className="mt-1 space-y-1" data-testid="tool-body">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {t(GROUP_TITLE_KEYS[kind])}
      </p>
      <p className="text-[10px] uppercase text-muted-foreground" data-testid="tool-group-count">
        {t("toolRenderers.group.count", { count: total })}
      </p>
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
