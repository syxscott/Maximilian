// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * todo renderer — the todo-list surface shared by the todo / todo-read /
 * todo-write tool names. Beyond the count/summary rows the body renders
 * the NORMALIZED items (coordination.model.ts) as a real checklist:
 * status glyph (○ pending / ◐ in progress / ✓ completed), content text,
 * optional priority badge. The localized title follows the concrete tool
 * name; falls back to the generic JSON preview when the payload carries
 * no todo-like array.
 */

import { useLocale, t } from "@max/i18n"
import type { ToolCallProps } from "../registry"
import { JsonFallback } from "./common"
import { extractTodo, type TodoItem, type TodoStatus } from "./coordination.model"

export const TODO_GLYPH = "☑"

const STATUS_GLYPHS: Record<TodoStatus, string> = {
  pending: "○",
  in_progress: "◐",
  completed: "✓",
}

function statusKey(status: TodoStatus): string {
  return `toolRenderers.todo.status.${status}`
}

function TodoRow({ item, index }: { item: TodoItem; index: number }) {
  useLocale()
  if (item.content.length === 0) return null
  return (
    <li className="flex items-start gap-1.5 text-xs leading-5" data-testid="todo-item">
      <span
        className={`shrink-0 font-mono ${
          item.status === "completed"
            ? "text-muted-foreground"
            : item.status === "in_progress"
              ? "text-foreground"
              : "text-muted-foreground"
        }`}
        aria-label={t(statusKey(item.status))}
      >
        {STATUS_GLYPHS[item.status]}
      </span>
      <span
        className={`min-w-0 flex-1 break-words ${
          item.status === "completed" ? "text-muted-foreground line-through" : ""
        }`}
      >
        {item.content}
      </span>
      {item.priority !== undefined && (
        <span
          className="shrink-0 rounded border border-border/60 px-1 text-[10px] uppercase text-muted-foreground"
          data-testid="todo-priority"
        >
          {item.priority}
        </span>
      )}
      <span className="sr-only">{index + 1}</span>
    </li>
  )
}

export function TodoBody({ tool, input }: ToolCallProps) {
  useLocale()
  const vm = extractTodo(input)
  const visible = vm.items.filter((item) => item.content.length > 0)
  if (vm.isEmpty) return <JsonFallback input={input} />
  return (
    <div className="mt-1" data-testid="tool-body">
      <p
        className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground"
        data-testid="tool-title"
      >
        {t(`toolRenderers.${tool}.title`)}
      </p>
      {visible.length > 0 ? (
        <ul className="space-y-0.5" data-testid="todo-list">
          {visible.map((item, i) => (
            <TodoRow key={`${i}-${item.content}`} item={item} index={i} />
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{t("toolRenderers.todo.empty")}</p>
      )}
    </div>
  )
}
