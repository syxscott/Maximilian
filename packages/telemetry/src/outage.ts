// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Warn-once outage tracking for best-effort telemetry sinks.
 *
 * (borrowing) Mechanism mirrors OpenAgentCore
 * services/core/internal/runtimeobs/exporter.go (exportDispatcher.run /
 * exportSafely): report an outage once, carrying only its outcome class
 * (error / timeout / panic), never the raw exporter or disk error body — a
 * collector response may embed sensitive data. The tracker resets on the
 * first success, so a later outage warns again.
 */

import { getLogger } from "./logger.js"

export type FailureOutcome = "error" | "timeout" | "panic"

/** Destination for outage transitions. */
export interface OutageSink {
  /** Called at most once per outage, on its first failed attempt. */
  warn(scope: string, outcome: FailureOutcome): void
  /** Called once when a previously failing scope succeeds again. */
  recovered(scope: string): void
}

/**
 * Default sink: structured warn lines via the package logger. Intentionally
 * receives no error object, so no raw body or stack can reach the log.
 */
export const defaultOutageSink: OutageSink = {
  warn(scope, outcome) {
    getLogger("telemetry").warn({ scope, outcome }, `${scope} failing (${outcome})`)
  },
  recovered(scope) {
    getLogger("telemetry").warn({ scope }, `${scope} recovered`)
  },
}

/**
 * Classify a caught export error into an outcome class without retaining it.
 * Timeout-like transport failures map to "timeout"; everything else is a
 * generic "error". Panics are detected separately by synchronous-throw
 * handling, not here.
 */
export function classifyFailure(err: unknown): FailureOutcome {
  if (!(err instanceof Error)) return "error"
  const code = (err as NodeJS.ErrnoException).code
  if (
    err.name === "TimeoutError" ||
    err.name === "DeadlineExceeded" ||
    code === "ETIMEDOUT" ||
    code === "ESOCKETTIMEDOUT" ||
    code === "UND_ERR_CONNECT_TIMEOUT"
  ) {
    return "timeout"
  }
  return "error"
}

/**
 * Per-scope failing flag with warn-once semantics.
 *
 * observe("error" | "timeout" | "panic") emits a single warning for a
 * contiguous run of failures; observe(undefined) on a failing scope emits
 * exactly one recovery line and clears the flag.
 */
export class OutageTracker {
  private failing = false

  constructor(
    private readonly scope: string,
    private readonly sink: OutageSink = defaultOutageSink,
  ) {}

  observe(outcome: FailureOutcome | undefined): void {
    if (outcome === undefined) {
      if (!this.failing) return
      this.failing = false
      this.sink.recovered(this.scope)
      return
    }
    if (!this.failing) this.sink.warn(this.scope, outcome)
    this.failing = true
  }
}
