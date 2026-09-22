// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for the runtime-event double-write listener: event mirroring,
 * conversation-turn derivation (plan → user, task-complete → assistant +
 * usage) and the steering receipt loop (enqueue → steering-applied →
 * consumed).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { SessionStore, createSessionRuntimeListener } from "../src/index.js"

let dir: string
let store: SessionStore
let onEvent: ReturnType<typeof createSessionRuntimeListener>

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-listener-"))
  store = new SessionStore({ path: path.join(dir, "store.db") })
  store.migrate()
  onEvent = createSessionRuntimeListener(store)
})

afterEach(() => {
  store.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe("createSessionRuntimeListener", () => {
  it("mirrors every event into the events table", () => {
    onEvent({ type: "workspace-status", workspaceId: "ws1", status: "running" })
    onEvent({ type: "task-failed", workspaceId: "ws1", taskId: "t1", error: "boom" })
    const events = store.listEvents("ws1")
    // listEvents returns newest-first.
    expect(events.map((e) => e.type)).toEqual(["task-failed", "workspace-status"])
  })

  it("derives the user turn from the plan event and dedupes replans", () => {
    onEvent({
      type: "plan",
      workspaceId: "ws1",
      plan: { id: "p1", userRequest: "build a login page" },
    })
    onEvent({
      type: "plan",
      workspaceId: "ws1",
      plan: { id: "p2", userRequest: "build a login page" },
    })
    const session = store.getSession("ws:ws1")
    expect(session).not.toBeNull()
    const messages = store.listMessages("ws:ws1")
    expect(messages).toHaveLength(1)
    expect(messages[0]?.role).toBe("user")
    expect(messages[0]?.content).toBe("build a login page")
  })

  it("derives the assistant turn and usage from task-complete", () => {
    onEvent({ type: "plan", workspaceId: "ws1", plan: { id: "p1", userRequest: "ask" } })
    onEvent({
      type: "task-complete",
      workspaceId: "ws1",
      taskId: "t1",
      result: {
        taskId: "t1",
        output: "the answer",
        metadata: { model: "m1", usage: { promptTokens: 100, completionTokens: 20 } },
      },
    })
    const messages = store.listMessages("ws:ws1")
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"])
    expect(messages[1]?.content).toBe("the answer")
    const usage = store.listUsage("ws1")
    expect(usage).toHaveLength(1)
    expect(usage[0]?.tokensIn).toBe(100)
    expect(usage[0]?.tokensOut).toBe(20)
  })

  it("closes the steering receipt loop: enqueue → applied event → consumed", () => {
    store.enqueueSteering({
      workspaceId: "ws1",
      text: "use dark mode",
      source: "api",
      receiptId: "str_1",
    })
    expect(store.pendingSteering("ws1")).toHaveLength(1)

    // The runtime drains the queue and labels the content — the listener
    // strips the label back to the raw stored text.
    onEvent({
      type: "steering-applied",
      workspaceId: "ws1",
      messages: [{ content: "[steering from api] use dark mode", at: "t" }],
      taskIds: [],
    })
    expect(store.pendingSteering("ws1")).toHaveLength(0)
  })

  it("ignores events without a workspace id", () => {
    expect(() => onEvent({ type: "plan", plan: { id: "p1", userRequest: "x" } })).not.toThrow()
    expect(store.listEvents("ws1")).toHaveLength(0)
  })
})
