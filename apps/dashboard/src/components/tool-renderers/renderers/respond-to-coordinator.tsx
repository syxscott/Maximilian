// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * respond-to-coordinator renderer — answer the coordinating agent. The
 * body leads with the addressed coordinator and the declared response
 * type (chips), keeps the owning task id and summary as rows, and shows
 * the full response as a clamped monospace block
 * (coordination.model.ts extractRespondToCoordinator); a usage payload
 * mounts as the ai-elements TokenUsageBadge; JSON fallback when the
 * payload is opaque.
 */

import { useLocale, t } from "@max/i18n"
import { TokenUsageBadge } from "@/components/ai-elements"
import type { ToolCallProps } from "../registry"
import { CodeBlock, FieldRows, JsonFallback } from "./common"
import { extractRespondToCoordinator } from "./coordination.model"
import { FIELDS, usageOf } from "./shared.model"

export const RESPOND_TO_COORDINATOR_GLYPH = "↩"

export function RespondToCoordinatorBody({ input }: ToolCallProps) {
  useLocale()
  const vm = extractRespondToCoordinator(input)
  if (vm.isEmpty) return <JsonFallback input={input} />
  const usage = usageOf(input)
  const rows = vm.rows.filter(
    (r) =>
      (vm.target === undefined || r.labelKey !== FIELDS.target) &&
      (vm.responseType === undefined || r.labelKey !== FIELDS.responseType),
  )
  return (
    <div className="mt-1" data-testid="tool-body">
      <p
        className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground"
        data-testid="tool-title"
      >
        {t("toolRenderers.respond-to-coordinator.title")}
      </p>
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        {vm.target !== undefined && (
          <span
            className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]"
            data-testid="respond-target"
          >
            {vm.target}
          </span>
        )}
        {vm.responseType !== undefined && (
          <span
            className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] uppercase text-primary"
            data-testid="respond-type"
          >
            {vm.responseType}
          </span>
        )}
      </div>
      {usage !== undefined && <TokenUsageBadge usage={usage} className="mb-1" />}
      <FieldRows rows={rows} />
      {vm.code && <CodeBlock text={vm.code.text} maxLines={vm.code.maxLines} />}
    </div>
  )
}
