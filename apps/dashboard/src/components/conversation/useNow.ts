// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * useNow — the wall-clock ticker behind the conversation's live
 * in-flight feedback (running-tool elapsed counters, running-turn
 * header durations). While `enabled` the host re-renders every
 * `intervalMs` with the current epoch ms; the interval is cleared on
 * unmount (and whenever disabled), so a timer never outlives the
 * component that spawned it. Disabled = a static mount-time snapshot.
 */
import { useEffect, useState } from "react"

/** Running-tool elapsed counters tick once a second. */
export const RUNNING_TOOL_TICK_MS = 1000

/** Running-turn header durations refresh every 5s. */
export const TURN_ELAPSED_TICK_MS = 5000

export function useNow(intervalMs: number, enabled = true): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [enabled, intervalMs])
  return now
}
