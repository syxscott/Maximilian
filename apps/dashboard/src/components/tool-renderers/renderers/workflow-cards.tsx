// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Workflow compact-card bodies — the "*-card" variants of get-workflow-run,
 * list-workflow-runs, resume-workflow-run and get-workflow-run-roster
 * (the "workflow-run-compact-card" display mode of the dynamic-workflow
 * family). The card leads with a chip row (status · phase · run count ·
 * run id) so the expanded surface stays info-dense on constrained
 * timelines, then the remaining field rows and — for rosters — the
 * numbered actor block. The extractors keep the chip dimensions OFF the
 * row list, so nothing renders twice. Falls back to the generic JSON
 * preview when the payload is opaque.
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
  type WorkflowCardViewModel,
} from "./workflow-cards.model"

export const GET_WORKFLOW_RUN_CARD_GLYPH = "◈"
export const LIST_WORKFLOW_RUNS_CARD_GLYPH = "▧"
export const RESUME_WORKFLOW_RUN_CARD_GLYPH = "⤾"
export const GET_WORKFLOW_RUN_ROSTER_CARD_GLYPH = "◫"

/** One compact-card chip (status / phase / count / run id). */
function Chip({ value, testId }: { value: string; testId: string }) {
  return (
    <span
      className="rounded bg-muted px-1 py-0.5 text-[10px] font-medium uppercase text-muted-foreground"
      data-testid={testId}
    >
      {value}
    </span>
  )
}

function CardShell({
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
        {vm.status !== undefined && <Chip value={vm.status} testId="card-chip-status" />}
        {vm.phase !== undefined && <Chip value={vm.phase} testId="card-chip-phase" />}
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
    <CardShell
      titleKey="toolRenderers.get-workflow-run-card.title"
      vm={extractGetWorkflowRunCard(props.input)}
      input={props.input}
    />
  )
}

export function ListWorkflowRunsCardBody(props: ToolCallProps) {
  return (
    <CardShell
      titleKey="toolRenderers.list-workflow-runs-card.title"
      vm={extractListWorkflowRunsCard(props.input)}
      input={props.input}
    />
  )
}

export function ResumeWorkflowRunCardBody(props: ToolCallProps) {
  return (
    <CardShell
      titleKey="toolRenderers.resume-workflow-run-card.title"
      vm={extractResumeWorkflowRunCard(props.input)}
      input={props.input}
    />
  )
}

export function GetWorkflowRunRosterCardBody(props: ToolCallProps) {
  const vm = extractGetWorkflowRunRosterCard(props.input)
  return (
    <CardShell
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
