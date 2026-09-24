// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * ask-question renderer — blocking question to the human. The body renders
 * the NORMALIZED question entries (coordination.model.ts): header chip,
 * question text, the option list with per-option descriptions, and a
 * multi-select marker. Falls back to the generic JSON preview when the
 * payload carries no question-shaped field.
 */

import { useLocale, t } from "@max/i18n"
import type { ToolCallProps } from "../registry"
import { JsonFallback } from "./common"
import { extractAskQuestion, type AskQuestionEntry } from "./coordination.model"

export const ASK_QUESTION_GLYPH = "?"

function QuestionCard({ entry, index }: { entry: AskQuestionEntry; index: number }) {
  useLocale()
  return (
    <div
      className="rounded border border-border/60 bg-background/60 p-1.5"
      data-testid="question-card"
    >
      <div className="mb-0.5 flex items-center gap-1.5">
        {entry.header !== undefined && (
          <span
            className="rounded bg-muted px-1 py-0.5 text-[10px] font-medium uppercase text-muted-foreground"
            data-testid="question-header"
          >
            {entry.header}
          </span>
        )}
        {entry.multiSelect && (
          <span
            className="rounded border border-border/60 px-1 text-[10px] text-muted-foreground"
            data-testid="question-multi"
          >
            {t("toolRenderers.askQuestion.multiSelect")}
          </span>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground">#{index + 1}</span>
      </div>
      <p className="text-xs font-medium" data-testid="question-text">
        {entry.question.length > 0 ? entry.question : t("toolRenderers.askQuestion.noText")}
      </p>
      {entry.options.length > 0 && (
        <ul className="mt-1 space-y-0.5" data-testid="question-options">
          {entry.options.map((option, i) => (
            <li key={`${i}-${option.label}`} className="text-xs leading-5">
              <span className="mr-1 font-mono text-muted-foreground">
                {String.fromCharCode(97 + (i % 26))}.
              </span>
              <span className="font-medium">{option.label}</span>
              {option.description !== undefined && (
                <span className="ml-1 text-muted-foreground">— {option.description}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function AskQuestionBody({ input }: ToolCallProps) {
  useLocale()
  const vm = extractAskQuestion(input)
  if (vm.isEmpty || vm.questions.length === 0) return <JsonFallback input={input} />
  return (
    <div className="mt-1 space-y-1" data-testid="tool-body">
      <p
        className="text-[10px] uppercase tracking-wide text-muted-foreground"
        data-testid="tool-title"
      >
        {t("toolRenderers.ask-question.title")}
      </p>
      {vm.questions.map((entry, i) => (
        <QuestionCard key={`${i}-${entry.question}`} entry={entry} index={i} />
      ))}
    </div>
  )
}
