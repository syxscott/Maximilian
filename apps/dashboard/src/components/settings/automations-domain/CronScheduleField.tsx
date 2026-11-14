// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * CronScheduleField — the schedule editor for the automation create dialog
 * (conductor scheduler borrowing): a template dropdown whose options carry
 * per-field colored 5-field expressions with a cronstrue subtitle, a
 * cursor-linked field-help legend (the field the caret sits in lights up,
 * `getHighlightedPart` + CronExpressionHelp borrowing re-indexed from
 * Quartz's six slots to our five), and a memoized next-runs preview with a
 * dual timezone readout (scheduler UTC vs browser local).
 */

import { useMemo, useState } from "react"
import cronstrue from "cronstrue/i18n"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { t, useLocale } from "@max/i18n"
import {
  CRON_FIELD_COLORS,
  CRON_FIELD_HELP,
  CRON_TEMPLATES,
  buildSchedulePreview,
  cursorToFieldIndex,
  toScheduleRunRows,
} from "./model"

/** cronstrue human description for template subtitles; never throws —
 *  hard validation ran in buildSchedulePreview already. */
function describeCron(expr: string, locale: string): string {
  try {
    return cronstrue.toString(expr, { locale: locale.startsWith("zh") ? "zh_CN" : "en" })
  } catch {
    return ""
  }
}

/**
 * One 5-field expression rendered with per-field accent colors — used
 * inside the template options (active option colored, others dimmed).
 */
function ColoredCron({ expr, active }: { expr: string; active: boolean }) {
  return (
    <span className="inline-flex gap-1.5 font-mono text-xs">
      {expr.split(" ").map((field, i) => (
        <span
          key={`${field}-${i}`}
          style={{
            color: CRON_FIELD_COLORS[i],
            opacity: active ? 1 : 0.55,
          }}
        >
          {field}
        </span>
      ))}
    </span>
  )
}

export interface CronScheduleFieldProps {
  value: string
  onChange: (next: string) => void
  /** Test hook for the memoized preview (fixed-clock jsdom tests). */
  previewOptions?: { now?: number }
}

export function CronScheduleField({ value, onChange, previewOptions }: CronScheduleFieldProps) {
  const { locale } = useLocale()
  /** Field the caret sits in; null until the user interacts with the input. */
  const [caretField, setCaretField] = useState<number | null>(null)

  const syncCaret = (element: HTMLInputElement) => {
    setCaretField(cursorToFieldIndex(element.value, element.selectionStart ?? 0))
  }

  const cronLike = value.trim().length > 0 && /\s/.test(value.trim())

  // Memoized validation + next-runs computation: recomputed only when the
  // expression (or clock, for tests) changes — the cron matcher walks the
  // calendar, so it must not run on every keystroke render.
  const preview = useMemo(
    () => buildSchedulePreview(value, { ...previewOptions, locale }),
    [value, previewOptions, locale],
  )
  const runRows = useMemo(
    () => (preview.nextRuns.length > 0 ? toScheduleRunRows(preview.nextRuns, locale) : []),
    [preview.nextRuns, locale],
  )

  return (
    <div className="space-y-1">
      <Label htmlFor="automations-draft-schedule">{t("automations.form.schedule")}</Label>
      <Input
        id="automations-draft-schedule"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onSelect={(e) => syncCaret(e.currentTarget)}
        onKeyUp={(e) => syncCaret(e.currentTarget)}
        onClick={(e) => syncCaret(e.currentTarget)}
        placeholder="*/5 * * * *  |  30000"
        className="h-8 font-mono text-xs"
        data-testid="automations-schedule-input"
      />

      {/* Template dropdown — colored expression + human subtitle per option. */}
      <Select value="" onValueChange={onChange}>
        <SelectTrigger
          className="h-8 w-full max-w-72 text-xs"
          aria-label={t("automations.form.templateLabel")}
          data-testid="automations-template-trigger"
        >
          <SelectValue placeholder={t("automations.form.templatePlaceholder")} />
        </SelectTrigger>
        <SelectContent>
          {CRON_TEMPLATES.map((template) => (
            <SelectItem key={template.expr} value={template.expr} textValue={template.expr}>
              <div className="flex flex-col gap-0.5 py-0.5">
                <ColoredCron expr={template.expr} active={value.trim() === template.expr} />
                <span className="text-[10px] text-muted-foreground">
                  {t(template.labelKey)} · {describeCron(template.expr, locale)}
                </span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Cursor-linked field help: the field the caret is in stays bright. */}
      {cronLike && (
        <div
          className="flex flex-wrap gap-x-3 gap-y-0.5"
          role="group"
          aria-label={t("automations.cron.fieldHelpLabel")}
          data-testid="automations-cron-help"
        >
          {CRON_FIELD_HELP.map((field, index) => (
            <span
              key={field.key}
              className="text-[10px] font-mono"
              style={{
                color: field.color,
                opacity: caretField === null || caretField === index ? 1 : 0.35,
              }}
              data-testid={`automations-cron-help-${index}`}
              data-active={caretField === index ? "true" : "false"}
            >
              {t(field.key)}
            </span>
          ))}
        </div>
      )}

      {/* Advisory preview: human description + next runs, dual timezone. */}
      {value.trim().length > 0 && (
        <div className="rounded border px-2 py-1.5" data-testid="automations-schedule-preview">
          {preview.errorKey !== null ? (
            <p className="text-xs text-destructive" data-testid="automations-preview-error">
              {t(preview.errorKey)}
              {preview.errorDetail !== null ? (
                <span className="ml-1 font-mono text-[10px]">{preview.errorDetail}</span>
              ) : null}
            </p>
          ) : (
            <>
              {preview.description !== null && (
                <p className="text-xs" data-testid="automations-preview-desc">
                  {preview.description}
                </p>
              )}
              {runRows.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("automations.preview.noRuns")}</p>
              ) : (
                <div className="mt-1" data-testid="automations-preview-runs">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t("automations.preview.title", { count: runRows.length })}
                  </p>
                  <table className="mt-0.5 w-full text-[10px]">
                    <thead>
                      <tr className="text-left text-muted-foreground">
                        <th className="pr-2 font-normal">{t("automations.preview.tzUtc")}</th>
                        <th className="font-normal">{t("automations.preview.tzLocal")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runRows.map((row, i) => (
                        <tr key={row.at} data-testid={`automations-preview-run-${i}`}>
                          <td className="pr-2 font-mono">{row.schedulerText}</td>
                          <td className="font-mono">{row.localText}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}
      <p className="text-[10px] text-muted-foreground">{t("automations.form.scheduleHint")}</p>
    </div>
  )
}
