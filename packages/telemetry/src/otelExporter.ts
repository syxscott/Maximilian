// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * OTLP span exporter wrapper with warn-once outage reporting.
 *
 * (borrowing) The classification and state machine follow OpenAgentCore
 * services/core/internal/runtimeobs/exporter.go: an export attempt yields
 * only an outcome class, the first failure of a run warns once, and the
 * first success clears the flag. The inner exporter's error is classified
 * and then discarded — never logged — because it can carry collector
 * response bodies.
 */

import { classifyFailure, OutageTracker, type FailureOutcome, type OutageSink } from "./outage.js"

export const EXPORT_RESULT_SUCCESS = 0
export const EXPORT_RESULT_FAILED = 1

/** Structural subset of @opentelemetry/core's ExportResult. */
export interface SpanExportResult {
  code: number
  error?: Error
}

export type SpanExportCallback = (result: SpanExportResult) => void

/**
 * Structural subset of @opentelemetry/sdk-trace-base's SpanExporter.
 * Declared locally so the package does not depend on transitive types.
 */
export interface SpanExporterLike {
  export(spans: readonly unknown[], resultCallback: SpanExportCallback): void
  shutdown(): Promise<void>
  forceFlush?(): Promise<void>
}

/** Export attempts that outlive this deadline are reported as "timeout". */
const EXPORT_DEADLINE_MS = 2_000

export class WarnOnceSpanExporter implements SpanExporterLike {
  private readonly tracker: OutageTracker

  constructor(
    private readonly inner: SpanExporterLike,
    sink?: OutageSink,
  ) {
    this.tracker = new OutageTracker("otlp trace export", sink)
  }

  export(spans: readonly unknown[], resultCallback: SpanExportCallback): void {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const settle = (outcome: FailureOutcome | undefined, code: number): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      this.tracker.observe(outcome)
      resultCallback({ code })
    }

    timer = setTimeout(() => settle("timeout", EXPORT_RESULT_FAILED), EXPORT_DEADLINE_MS)

    try {
      this.inner.export(spans, (result) => {
        if (result.code === EXPORT_RESULT_SUCCESS) {
          settle(undefined, EXPORT_RESULT_SUCCESS)
          return
        }
        settle(classifyFailure(result.error), EXPORT_RESULT_FAILED)
      })
    } catch {
      // A synchronous throw is a panic, mirroring the Go recover() path.
      settle("panic", EXPORT_RESULT_FAILED)
    }
  }

  async shutdown(): Promise<void> {
    await this.inner.shutdown()
  }

  async forceFlush(): Promise<void> {
    await this.inner.forceFlush?.()
  }
}
