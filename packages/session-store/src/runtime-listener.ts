// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Runtime-event listener for the double-write path (mcode migration
 * pattern). Attach the returned function to an `AgentRuntime` via
 * `runtime.on(...)`; every event is mirrored into the SQLite `events`
 * table while the legacy JSONL log keeps operating unchanged.
 *
 * Beyond raw mirroring it derives the conversation-shaped rows:
 *   - `plan` → user turn (`plan.userRequest`) in a per-workspace session,
 *   - `task-complete` → assistant turn (`result.output`) + token usage,
 *   - `steering-applied` → pending `steering_queue` rows whose text was
 *     drained are marked consumed (receipt loop closed without threading
 *     receipt ids through the runtime's in-memory queue).
 *
 * Deliberately fail-closed on nothing: structural mismatches are skipped,
 * store errors propagate (the caller decides whether that is fatal — the
 * JSONL side is written independently and stays authoritative).
 */

import type { SessionStore } from "./index.js"

/** Structural subset of a runtime event (no @max/core dependency). */
export interface SessionRuntimeEvent {
  type: string
  workspaceId?: string
  taskId?: string
  [key: string]: unknown
}

/** The runtime prefixes steered content with `[steering …] ` labels. */
const STEERING_LABEL = /^\[steering[^\]]*\]\s*/

export function createSessionRuntimeListener(
  store: SessionStore,
): (event: SessionRuntimeEvent) => void {
  // Session rows are per-workspace; create once per process (updatedAt
  // refreshes are not worth an extra upsert per event).
  const ensuredSessions = new Set<string>()
  // Replans re-emit the same userRequest — one user turn per distinct ask.
  const lastUserRequests = new Map<string, string>()

  function ensureSession(workspaceId: string, title: string): string {
    const sessionId = `ws:${workspaceId}`
    if (!ensuredSessions.has(sessionId)) {
      store.appendSession({ id: sessionId, workspaceId, title })
      ensuredSessions.add(sessionId)
    }
    return sessionId
  }

  return function onRuntimeEvent(event: SessionRuntimeEvent): void {
    const workspaceId = event.workspaceId
    if (!workspaceId || typeof workspaceId !== "string") return

    store.appendEvent({ workspaceId, type: event.type, payload: payloadOf(event) })

    if (event.type === "plan") {
      const plan = event.plan as { id?: string; userRequest?: string } | undefined
      const ask = typeof plan?.userRequest === "string" ? plan.userRequest : undefined
      if (ask && ask.length > 0 && lastUserRequests.get(workspaceId) !== ask) {
        lastUserRequests.set(workspaceId, ask)
        const sessionId = ensureSession(workspaceId, ask.slice(0, 80))
        store.appendMessage({
          id: `msg:${plan?.id ?? "plan"}:user`,
          sessionId,
          role: "user",
          content: ask,
        })
      }
    }

    if (event.type === "task-complete") {
      const result = event.result as
        | {
            taskId?: string
            output?: string
            metadata?: {
              model?: string
              usage?: { promptTokens?: number; completionTokens?: number }
            }
          }
        | undefined
      const output = typeof result?.output === "string" ? result.output : undefined
      if (output !== undefined) {
        const sessionId = ensureSession(workspaceId, "workspace session")
        store.appendMessage({
          id: `msg:${result?.taskId ?? event.taskId ?? "task"}:assistant`,
          sessionId,
          role: "assistant",
          content: output,
        })
      }
      const usage = result?.metadata?.usage
      if (usage && (usage.promptTokens !== undefined || usage.completionTokens !== undefined)) {
        store.recordUsage({
          workspaceId,
          role: "assistant",
          model: result?.metadata?.model,
          tokensIn: usage.promptTokens,
          tokensOut: usage.completionTokens,
        })
      }
    }

    if (event.type === "steering-applied") {
      const messages = event.messages as Array<{ content?: string }> | undefined
      const texts = (messages ?? [])
        .map((m) => (typeof m?.content === "string" ? m.content.replace(STEERING_LABEL, "") : ""))
        .filter((t) => t.length > 0)
      if (texts.length > 0) store.consumeSteeringTexts(workspaceId, texts)
    }
  }
}

/** Strip the event envelope down to a storable payload. */
function payloadOf(event: SessionRuntimeEvent): unknown {
  const { type: _type, workspaceId: _workspaceId, taskId: _taskId, ...rest } = event
  return Object.keys(rest).length > 0 ? rest : undefined
}
