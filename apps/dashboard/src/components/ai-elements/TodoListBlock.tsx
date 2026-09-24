// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * TodoListBlock — assistant todo checklist (ZCode todo borrowing):
 * checkbox state, priority flag and a done/total footer.
 */
import { Check, Flag } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { useLocale, t } from "@max/i18n"
import { cn } from "@/lib/utils"
import { todoListModel } from "./model"
import type { TodoPriority } from "./model"

export interface TodoListBlockProps {
  /** Raw todos, or a passthrough { todos: [...] } part. */
  todos: unknown
  className?: string
}

const PRIORITY_FLAG: Record<TodoPriority, { icon: LucideIcon; className: string }> = {
  high: { icon: Flag, className: "text-red-500" },
  medium: { icon: Flag, className: "text-amber-500" },
  low: { icon: Flag, className: "text-muted-foreground/50" },
}

export function TodoListBlock({ todos, className }: TodoListBlockProps) {
  useLocale()
  const items = todoListModel(todos)
  const done = items.filter((item) => item.completed).length

  return (
    <div
      aria-label={t("aiElements.todo.aria")}
      className={cn("rounded-md border border-border bg-muted/20 text-xs py-1", className)}
    >
      {items.length === 0 ? (
        <div className="px-3 py-1.5 text-muted-foreground italic">{t("aiElements.todo.empty")}</div>
      ) : (
        <>
          <ul>
            {items.map((item, i) => {
              const flag = PRIORITY_FLAG[item.priority]
              return (
                <li key={i} className="flex items-center gap-2 px-3 py-1">
                  <span
                    role="checkbox"
                    aria-checked={item.completed}
                    aria-label={item.text}
                    className={cn(
                      "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border",
                      item.completed
                        ? "border-emerald-500 bg-emerald-500 text-white"
                        : "border-border bg-background",
                    )}
                  >
                    {item.completed && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                  </span>
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      item.completed && "text-muted-foreground line-through",
                    )}
                    title={item.text}
                  >
                    {item.text}
                  </span>
                  <flag.icon
                    aria-label={t(`aiElements.todo.priority.${item.priority}`)}
                    className={cn("h-3 w-3 shrink-0", flag.className)}
                  />
                </li>
              )
            })}
          </ul>
          <div className="px-3 py-1 border-t border-border/60 text-[10px] text-muted-foreground tabular-nums">
            {t("aiElements.todo.progress", { done, total: items.length })}
          </div>
        </>
      )}
    </div>
  )
}
