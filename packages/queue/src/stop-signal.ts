// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Cross-process workspace stop signal (Redis pub/sub).
 *
 * A user stop can arrive at the API while the target workspace executes in
 * the worker process — `runtime.abort()` only reaches the runtime instance
 * in the caller's process. The stop route therefore signals both: abort
 * locally (in-process runs) and publish here (worker runs). The worker
 * subscribes at startup and aborts its own runtime.
 *
 * At-least-once delivery: pub/sub has no delivery guarantee, so the worker
 * treats a missed signal the same as before this module existed (the run
 * finishes) — the stop route's local abort plus the stop-suppression window
 * remain the correctness backstop for queued/re-fired work.
 */

import { Redis } from "ioredis"

/** Canonical pub/sub channel — must match between publisher and subscriber. */
export const WORKSPACE_STOP_CHANNEL = "maximilian:workspace:stop"

export interface WorkspaceStopSignal {
  workspaceId: string
  reason?: string
  /** Which surface issued the stop (api route, admin tool, …). Free-form. */
  source?: string
}

/** Serialize a signal; returns null for payloads that decode to garbage. */
export function encodeStopSignal(signal: WorkspaceStopSignal): string {
  return JSON.stringify(signal)
}

export function decodeStopSignal(raw: string): WorkspaceStopSignal | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) return null
    const workspaceId = (parsed as { workspaceId?: unknown }).workspaceId
    if (typeof workspaceId !== "string" || workspaceId.length === 0) return null
    const reason = (parsed as { reason?: unknown }).reason
    const source = (parsed as { source?: unknown }).source
    return {
      workspaceId,
      ...(typeof reason === "string" ? { reason } : {}),
      ...(typeof source === "string" ? { source } : {}),
    }
  } catch {
    return null
  }
}

/** Publish a stop signal (API side). Fire-and-forget with a bounded wait. */
export async function publishWorkspaceStop(
  redisUrl: string,
  signal: WorkspaceStopSignal,
): Promise<void> {
  const publisher = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 })
  try {
    await publisher.publish(WORKSPACE_STOP_CHANNEL, encodeStopSignal(signal))
  } finally {
    publisher.disconnect()
  }
}

/**
 * Subscribe to stop signals (worker side). Returns an unsubscribe that
 * closes the dedicated subscriber connection (ioredis requires a separate
 * connection for subscribe mode — the worker's other Redis clients stay
 * untouched). Malformed messages are counted via `onMalformed` instead of
 * throwing the subscription down.
 */
export async function subscribeWorkspaceStop(
  redisUrl: string,
  onSignal: (signal: WorkspaceStopSignal) => void,
  onMalformed?: (raw: string) => void,
): Promise<() => Promise<void>> {
  const subscriber = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 })
  await subscriber.subscribe(WORKSPACE_STOP_CHANNEL)
  subscriber.on("message", (channel: string, raw: string) => {
    if (channel !== WORKSPACE_STOP_CHANNEL) return
    const signal = decodeStopSignal(raw)
    if (signal === null) {
      onMalformed?.(raw)
      return
    }
    onSignal(signal)
  })
  return async () => {
    subscriber.disconnect()
  }
}
