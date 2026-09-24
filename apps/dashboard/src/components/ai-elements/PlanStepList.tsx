// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * PlanStepList — execution plan checklist (ZCode plan borrowing): one row
 * per step with a status icon and dependency-driven indentation (each
 * `dependsOn` level indents the step one notch).
 */
import { CheckCircle2, Circle, Loader2, MinusCircle, XCircle } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { useLocale, t } from "@max/i18n"
import { cn } from "@/lib/utils"
import { planStepListModel } from "./model"
import type { PillVariant } from "./model"

export interface PlanStepListProps {
  /** Raw plan, or a passthrough { steps: [...] } part. */
  steps: unknown
  className?: string
}

const STEP_ICONS: Record<PillVariant, LucideIcon> = {
  pending: Circle,
  running: Loader2,
  completed: CheckCircle2,
  failed: XCircle,
  skipped: MinusCircle,
}

const STEP_ICON_CLASSES: Record<PillVariant, string> = {
  pending: "text-muted-foreground",
  running: "text-blue-600 animate-spin",
  completed: "text-emerald-600",
  failed: "text-red-600",
  skipped: "text-muted-foreground/60",
}

export function PlanStepList({ steps, className }: PlanStepListProps) {
  useLocale()
  const items = planStepListModel(steps)

  return (
    <ol
      aria-label={t("aiElements.plan.aria")}
      className={cn("rounded-md border border-border bg-muted/20 text-xs py-1", className)}
    >
      {items.length === 0 ? (
        <li className="px-3 py-1.5 text-muted-foreground italic">{t("aiElements.plan.empty")}</li>
      ) : (
        items.map((step, i) => {
          const Icon = STEP_ICONS[step.status]
          return (
            <li
              key={i}
              className="flex items-center gap-2 px-3 py-1"
              style={{ paddingLeft: `${12 + step.depth * 16}px` }}
            >
              <Icon
                aria-hidden="true"
                className={cn("h-3.5 w-3.5 shrink-0", STEP_ICON_CLASSES[step.status])}
              />
              <span
                className={cn(
                  "min-w-0 truncate",
                  step.status === "completed" || step.status === "skipped"
                    ? "text-muted-foreground line-through decoration-border"
                    : step.status === "failed"
                      ? "text-red-700"
                      : undefined,
                )}
                title={step.title}
              >
                {step.title}
              </span>
            </li>
          )
        })
      )}
    </ol>
  )
}
