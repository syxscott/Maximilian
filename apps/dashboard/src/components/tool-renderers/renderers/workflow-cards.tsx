// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Workflow compact-card bodies — the "*-card" variants of get-workflow-run,
 * list-workflow-runs, resume-workflow-run and get-workflow-run-roster
 * (the "workflow-run-compact-card" display mode of the dynamic-workflow
 * family). All four mount the ONE shared CompactWorkflowCard shell, which
 * leads with a tone-mapped chip row (status · phase · progress · count ·
 * run id) so the expanded surface stays info-dense on constrained
 * timelines, then the remaining field rows and — for rosters — the
 * numbered actor block. Chip tones come from the phaseTone model mapping
 * (workflow-cards.model.ts) — the progress chip from the progressTone
 * mapping over the phaseProgress dimension; progress renders as
 * completed/total. The
 * extractors keep the chip dimensions OFF the row list, so nothing renders
 * twice. Falls back to the generic JSON preview when the payload is opaque.
 */

import type { ReactNode } from "react"
import { useLocale, t } from "@max/i18n"
import type { ToolCallProps } from "../registry"
import { FieldRows, JsonFallback } from "./common"
import {
  extractGetWorkflowRunCard,
  extractGetWorkflowRunRosterCard,
  extractListWorkflowRunsCard,
  extractResumeWorkflowRunCard,
  phaseTone,
  progressTone,
  type PhaseTone,
  type WorkflowCardViewModel,
} from "./workflow-cards.model"
import { progressText } from "./workflow.model"

export const GET_WORKFLOW_RUN_CARD_GLYPH = "◈"
export const LIST_WORKFLOW_RUNS_CARD_GLYPH = "▧"
export const RESUME_WORKFLOW_RUN_CARD_GLYPH = "⤾"
export const GET_WORKFLOW_RUN_ROSTER_CARD_GLYPH = "◫"

/** Badge classes per phase/status tone (presentation half of the mapping). */
const TONE_CLASS: Record<PhaseTone, string> = {
  done: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  error: "bg-red-500/15 text-red-700 dark:text-red-400",
  running: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  neutral: "bg-muted text-muted-foreground",
}

/** One compact-card chip (status / phase / progress / count / run id),
 *  tone-mapped through the model's phaseTone vocabulary. */
function Chip({
  value,
  testId,
  tone = "neutral",
}: {
  value: string
  testId: string
  tone?: PhaseTone
}) {
  return (
    <span
      className={`rounded px-1 py-0.5 text-[10px] font-medium uppercase ${TONE_CLASS[tone]}`}
      data-testid={testId}
      data-tone={tone}
    >
      {value}
    </span>
  )
}

/**
 * The shared compact-card shell for the whole workflow-run-compact-card
 * display mode: localized title, tone-mapped chips, optional extra widget
 * (the roster's actor block), then the remaining field rows.
 */
export function CompactWorkflowCard({
  titleKey,
  vm,
  input,
  extra,
}: {
  titleKey: string
  vm: WorkflowCardViewModel
  input: unknown
  extra?: ReactNode
}) {
  useLocale()
  if (vm.isEmpty) return <JsonFallback input={input} />
  return (
    <div className="mt-1" data-testid="tool-body">
      <p
        className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground"
        data-testid="tool-title"
      >
        {t(titleKey)}
      </p>
      <div className="mb-1 flex flex-wrap items-center gap-1" data-testid="card-chips">
        {vm.status !== undefined && (
          <Chip value={vm.status} testId="card-chip-status" tone={phaseTone(vm.status)} />
        )}
        {vm.phase !== undefined && (
          <Chip value={vm.phase} testId="card-chip-phase" tone={phaseTone(vm.phase)} />
        )}
        {vm.progress !== undefined && (
          <Chip
            value={progressText(vm.progress)}
            testId="card-chip-progress"
            tone={progressTone(vm.progress, vm.status ?? vm.phase)}
          />
        )}
        {vm.count !== undefined && <Chip value={`×${vm.count}`} testId="card-chip-count" />}
        {vm.run !== undefined && <Chip value={vm.run} testId="card-chip-run" />}
      </div>
      {extra}
      <FieldRows rows={vm.rows} />
    </div>
  )
}

export function GetWorkflowRunCardBody(props: ToolCallProps) {
  return (
    <CompactWorkflowCard
      titleKey="toolRenderers.get-workflow-run-card.title"
      vm={extractGetWorkflowRunCard(props.input)}
      input={props.input}
    />
  )
}

export function ListWorkflowRunsCardBody(props: ToolCallProps) {
  return (
    <CompactWorkflowCard
      titleKey="toolRenderers.list-workflow-runs-card.title"
      vm={extractListWorkflowRunsCard(props.input)}
      input={props.input}
    />
  )
}

export function ResumeWorkflowRunCardBody(props: ToolCallProps) {
  return (
    <CompactWorkflowCard
      titleKey="toolRenderers.resume-workflow-run-card.title"
      vm={extractResumeWorkflowRunCard(props.input)}
      input={props.input}
    />
  )
}

export function GetWorkflowRunRosterCardBody(props: ToolCallProps) {
  const vm = extractGetWorkflowRunRosterCard(props.input)
  return (
    <CompactWorkflowCard
      titleKey="toolRenderers.get-workflow-run-roster-card.title"
      vm={vm}
      input={props.input}
      extra={
        vm.code !== undefined ? (
          <pre
            className="mb-1 max-h-32 overflow-auto rounded border border-border/60 bg-muted/40 p-2 text-xs font-mono leading-5 m-0"
            data-testid="card-actors"
          >
            {vm.code.text}
          </pre>
        ) : undefined
      }
    />
  )
}
