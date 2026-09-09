// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

// @max/gateway — resident channel layer (openclaw borrowing)
import type { OutboundNotification } from "./types.js"

export * from "./types.js"
export * from "./gateway.js"
export { createWebhookAdapter, createConsoleAdapter } from "./adapters.js"

/** Convenience: workspace completion notification factory for workers. */
export function workspaceCompletedNotification(input: {
  channel: string
  recipientId: string
  workspaceId: string
  status: string
  taskCount?: number
  error?: string
}): OutboundNotification {
  const failed = input.status === "failed"
  return {
    channel: input.channel,
    recipientId: input.recipientId,
    title: failed
      ? `Workspace ${input.workspaceId} failed`
      : `Workspace ${input.workspaceId} completed`,
    body: input.error ?? `${input.taskCount ?? 0} task(s) finished with status "${input.status}".`,
    workspaceId: input.workspaceId,
    severity: failed ? "error" : "info",
  }
}
