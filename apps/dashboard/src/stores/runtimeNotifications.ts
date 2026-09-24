// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Runtime-event → notificationStore bridge (deep store wiring): the
 * App-level workspace stream handler calls these on the events that
 * deserve a durable notification — today the steering-applied wave.
 * Kept beside the stores so the App wiring, the ToastHost consumer and
 * the tests all exercise one implementation instead of hand-rolling
 * push() calls with ad-hoc param shaping.
 */
import { useNotificationStore } from "@/stores/notificationStore"

/**
 * Shape the steering target param: passthrough events carry `taskIds`
 * (array) or a single `taskId`; anything unparseable collapses to "?" so
 * the i18n placeholder never renders "undefined".
 */
export function steeringTaskParam(value: unknown): string {
  const ids = Array.isArray(value) ? value : [value]
  const names: string[] = []
  for (const id of ids) {
    if (typeof id === "string" && id.trim() !== "") names.push(id.trim().slice(0, 60))
    if (names.length === 3) break
  }
  return names.length > 0 ? names.join(", ") : "?"
}

/**
 * Notify that a steering wave was APPLIED to the running task(s) — the
 * user-visible counterpart of the agent-events timeline entry. Info
 * kind: the run continues, nothing needs a decision.
 */
export function notifySteeringApplied(taskIds: unknown): void {
  useNotificationStore.getState().push("info", "shell.notify.steeringApplied", {
    task: steeringTaskParam(taskIds),
  })
}
