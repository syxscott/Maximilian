// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest"
import Database from "better-sqlite3"
import {
  DEFAULT_PAIRING_TABLE,
  sanitizeHistoryItems,
  sanitizeReplayContent,
  type HistoryItem,
  type PairingTable,
} from "../src/message-sanitizer.js"
import { SessionStore } from "../src/index.js"

function call(callId: string, name = "bash"): HistoryItem {
  return { type: "function_call", call_id: callId, name, arguments: "{}" }
}
function output(callId: string, text = "ok"): HistoryItem {
  return { type: "function_call_output", call_id: callId, output: text }
}
function reasoning(id: string): HistoryItem {
  return { type: "reasoning", id, summary: [] }
}
function message(id: string, text = "hello"): HistoryItem {
  return { type: "message", id, role: "user", content: text }
}
function approvalRequest(id: string): HistoryItem {
  return { type: "mcp_approval_request", id, name: "shell" }
}
function approvalResponse(requestId: string): HistoryItem {
  return { type: "mcp_approval_response", approval_request_id: requestId, decision: "approve" }
}

const types = (items: readonly HistoryItem[]) => items.map((i) => i.type)

describe("sanitizeHistoryItems — call_id pairing (rule 1)", () => {
  it("keeps a complete pair", () => {
    const result = sanitizeHistoryItems([call("c1"), output("c1"), message("m1")])
    expect(types(result.items)).toEqual(["function_call", "function_call_output", "message"])
    expect(result.report).toEqual({ filtered: 0, orphanedPairs: 0, orphanedFollowers: 0 })
  })

  it("drops a call whose output is missing", () => {
    const result = sanitizeHistoryItems([call("c1"), message("m1")])
    expect(types(result.items)).toEqual(["message"])
    expect(result.report.orphanedPairs).toBe(1)
  })

  it("drops an output whose call is missing", () => {
    const result = sanitizeHistoryItems([message("m1"), output("c1")])
    expect(types(result.items)).toEqual(["message"])
    expect(result.report.orphanedPairs).toBe(1)
  })

  it("drops BOTH halves of a pair when rewind cut one side out of the window", () => {
    // Replay window starts after the call: the surviving output is an orphan.
    const result = sanitizeHistoryItems([call("c1"), output("c1"), message("m1")].slice(1))
    expect(types(result.items)).toEqual(["message"])
  })

  it("intersects id SETS: pair c1 complete, c2 call-only, c3 output-only", () => {
    const result = sanitizeHistoryItems([
      call("c1"),
      output("c1"),
      call("c2"),
      output("c3"),
      message("m1"),
    ])
    expect(types(result.items)).toEqual(["function_call", "function_call_output", "message"])
    expect(result.report.orphanedPairs).toBe(2)
  })

  it("drops a paired-type item with a missing link id", () => {
    const result = sanitizeHistoryItems([
      { type: "function_call", name: "bash" }, // no call_id
      { type: "function_call_output", call_id: "ghost" },
    ])
    expect(result.items).toEqual([])
    expect(result.report.orphanedPairs).toBe(2)
  })

  it("supports custom link fields", () => {
    const table: PairingTable = {
      rules: [
        {
          kind: "call-id",
          callTypes: ["shell_call"],
          outputTypes: ["shell_output"],
          linkField: "callId",
        },
      ],
    }
    const result = sanitizeHistoryItems(
      [
        { type: "shell_call", callId: "s1" },
        { type: "shell_output", callId: "s1" },
        { type: "shell_call", callId: "s2" },
      ],
      table,
    )
    expect(types(result.items)).toEqual(["shell_call", "shell_output"])
    expect(result.report.orphanedPairs).toBe(1)
  })
})

describe("sanitizeHistoryItems — approval request/response pairing (rule 2)", () => {
  it("keeps a matched request/response pair", () => {
    const result = sanitizeHistoryItems([approvalRequest("a1"), approvalResponse("a1")])
    expect(types(result.items)).toEqual(["mcp_approval_request", "mcp_approval_response"])
    expect(result.report.orphanedPairs).toBe(0)
  })

  it("drops an orphaned request and an orphaned response", () => {
    const result = sanitizeHistoryItems([approvalRequest("a1"), approvalResponse("a2")])
    expect(result.items).toEqual([])
    expect(result.report.orphanedPairs).toBe(2)
  })

  it("supports custom link fields", () => {
    const table: PairingTable = {
      rules: [
        {
          kind: "request-response",
          requestTypes: ["perm_request"],
          responseTypes: ["perm_decision"],
          requestIdField: "req",
          responseLinkField: "for",
        },
      ],
    }
    const result = sanitizeHistoryItems(
      [
        { type: "perm_request", req: "p1" },
        { type: "perm_decision", for: "p1" },
        { type: "perm_decision", for: "p9" },
      ],
      table,
    )
    expect(types(result.items)).toEqual(["perm_request", "perm_decision"])
    expect(result.report.orphanedPairs).toBe(1)
  })
})

describe("sanitizeHistoryItems — adjacent-follower (rule 3)", () => {
  it("keeps a reasoning item whose original follower survived", () => {
    const result = sanitizeHistoryItems([reasoning("r1"), call("c1"), output("c1")])
    expect(types(result.items)).toEqual(["reasoning", "function_call", "function_call_output"])
  })

  it("drops a trailing reasoning item (no follower at all)", () => {
    const result = sanitizeHistoryItems([message("m1"), reasoning("r1")])
    expect(types(result.items)).toEqual(["message"])
    expect(result.report.orphanedFollowers).toBe(1)
  })

  it("drops a reasoning item whose follower was dropped by pairing, and then the follower does NOT reappear", () => {
    const result = sanitizeHistoryItems([reasoning("r1"), call("c1"), message("m1")])
    // call c1 is an orphan (no output) → dropped → r1 loses its follower → dropped.
    expect(types(result.items)).toEqual(["message"])
    expect(result.report.orphanedPairs).toBe(1)
    expect(result.report.orphanedFollowers).toBe(1)
  })

  it("cascades through chained reasoning items right-to-left", () => {
    // The trailing call is orphaned; its removal cascades r2 -> r1.
    const result = sanitizeHistoryItems([reasoning("r1"), reasoning("r2"), call("c1")])
    expect(result.items).toEqual([])
    expect(result.report.orphanedFollowers).toBe(2)
  })

  it("keeps a plain message that originally followed a kept reasoning item", () => {
    const result = sanitizeHistoryItems([reasoning("r1"), message("m2")])
    expect(types(result.items)).toEqual(["reasoning", "message"])
  })

  it("does not cascade into unrelated items after the anchor chain ends", () => {
    const result = sanitizeHistoryItems([
      reasoning("r1"),
      output("ghost"), // orphan output → dropped → r1 dropped
      message("m2"), // did NOT follow r1 directly (output did) → kept
    ])
    expect(types(result.items)).toEqual(["message"])
  })
})

describe("sanitizeHistoryItems — filtered types and table extensibility", () => {
  it("strips filtered types before pairing", () => {
    const result = sanitizeHistoryItems([
      { type: "mcp_list_tools", tools: [] },
      call("c1"),
      output("c1"),
    ])
    expect(types(result.items)).toEqual(["function_call", "function_call_output"])
    expect(result.report.filtered).toBe(1)
  })

  it("accepts a custom table (new message types = new table entries, no new code)", () => {
    const table: PairingTable = {
      rules: [
        {
          kind: "call-id",
          callTypes: ["my_tool_use"],
          outputTypes: ["my_tool_result"],
          linkField: "txn",
        },
        { kind: "adjacent-follower", anchorTypes: ["my_thought"] },
      ],
    }
    const result = sanitizeHistoryItems(
      [
        { type: "my_thought", id: "t1" },
        { type: "my_tool_use", txn: "x1" },
        { type: "my_tool_result", txn: "x1" },
      ],
      table,
    )
    expect(types(result.items)).toEqual(["my_thought", "my_tool_use", "my_tool_result"])
  })

  it("lets the first matching rule govern an item when tables overlap", () => {
    const table: PairingTable = {
      rules: [
        { kind: "call-id", callTypes: ["x"], outputTypes: ["y"], linkField: "call_id" },
        { kind: "request-response", requestTypes: ["x"], responseTypes: ["z"] },
      ],
    }
    const result = sanitizeHistoryItems(
      [
        { type: "x", call_id: "k" },
        { type: "y", call_id: "k" },
        { type: "z", id: "k" },
      ],
      table,
    )
    // x/y matched under rule 1; z is governed by rule 2 but its request "x"
    // was consumed by rule 1, so rule 2 sees an orphaned response.
    expect(types(result.items)).toEqual(["x", "y"])
    expect(result.report.orphanedPairs).toBe(1)
  })

  it("passes through items with no type and an empty table keeps everything", () => {
    const empty: PairingTable = { rules: [] }
    const items = [{ content: "no type field" }, reasoning("r1"), message("m1")] as HistoryItem[]
    const result = sanitizeHistoryItems(items, empty)
    expect(result.items).toHaveLength(3)
  })

  it("does not mutate the input array", () => {
    const items = [call("c1"), output("c1"), reasoning("r1")]
    const snapshot = JSON.stringify(items)
    sanitizeHistoryItems(items)
    expect(JSON.stringify(items)).toBe(snapshot)
  })
})

describe("sanitizeReplayContent", () => {
  it("rewrites a JSON-array content that contained orphans", () => {
    const content = JSON.stringify([call("c1"), output("c1"), output("ghost")])
    const result = sanitizeReplayContent(content)
    expect(JSON.parse(result.content)).toHaveLength(2)
    expect(result.report?.orphanedPairs).toBe(1)
    expect(result.droppedAll).toBe(false)
  })

  it("flags rows whose items were ALL orphaned", () => {
    const result = sanitizeReplayContent(JSON.stringify([call("lonely")]))
    expect(result.droppedAll).toBe(true)
    expect(result.report?.orphanedPairs).toBe(1)
  })

  it("leaves plain-text content untouched", () => {
    const result = sanitizeReplayContent("just a user message")
    expect(result.content).toBe("just a user message")
    expect(result.report).toBeNull()
    expect(result.droppedAll).toBe(false)
  })

  it("leaves non-array JSON (objects) untouched", () => {
    const content = JSON.stringify({ type: "function_call", call_id: "c1" })
    const result = sanitizeReplayContent(content)
    expect(result.content).toBe(content)
    expect(result.report).toBeNull()
  })
})

describe("SessionStore.replayMessages — the replay exit", () => {
  it("excludes soft-deleted rows and sanitizes orphan pairs left by rewindFromTurn", () => {
    const store = new SessionStore({ path: ":memory:" }).migrate()
    const sessionId = "ws:demo"
    store.appendSession({ id: sessionId, workspaceId: "demo" })
    // Turn 0: a complete pair. Turn 1: a pair plus a stray ghost output, and
    // a call-only row that is an orphan even before any rewind.
    store.appendMessage({
      id: "m1",
      sessionId,
      role: "assistant",
      content: JSON.stringify([call("c1"), output("c1")]),
      turnOrdinal: 0,
    })
    store.appendMessage({
      id: "m2",
      sessionId,
      role: "assistant",
      content: JSON.stringify([reasoning("r1"), call("c2"), output("c2"), output("ghost")]),
      turnOrdinal: 1,
    })
    store.appendMessage({
      id: "m3",
      sessionId,
      role: "assistant",
      content: JSON.stringify([call("c9")]),
      turnOrdinal: 1,
    })
    store.appendMessage({
      id: "m4",
      sessionId,
      role: "user",
      content: "plain text",
      turnOrdinal: 2,
    })

    const before = store.replayMessages(sessionId)
    // m3 is dropped outright: ALL of its items are orphaned fragments.
    expect(before.map((r) => r.id)).toEqual(["m1", "m2", "m4"])

    const hidden = store.rewindFromTurn(sessionId, 2)
    expect(hidden).toBe(1) // m4

    const after = store.replayMessages(sessionId, { fromTurnOrdinal: 2 })
    expect(after).toHaveLength(0)

    // The general replay view: sanitized rows carry what survived.
    const view = store.replayMessages(sessionId)
    expect(view.map((r) => r.id)).toEqual(["m1", "m2"])
    expect(view[1]!.sanitizeReport?.orphanedPairs).toBe(1)
    const items = JSON.parse(view[1]!.content) as HistoryItem[]
    expect(types(items)).toEqual(["reasoning", "function_call", "function_call_output"])
    store.close()
  })

  it("drops rows whose items are all orphaned, keeps plain-text rows", () => {
    const store = new SessionStore({ path: ":memory:" }).migrate()
    const sessionId = "ws:demo2"
    store.appendSession({ id: sessionId, workspaceId: "demo" })
    store.appendMessage({
      id: "a",
      sessionId,
      role: "assistant",
      content: JSON.stringify([call("x")]),
    })
    store.appendMessage({ id: "b", sessionId, role: "user", content: "hello" })
    const rows = store.replayMessages(sessionId)
    expect(rows.map((r) => r.id)).toEqual(["b"])
    store.close()
  })

  it("uses a custom pairing table when asked", () => {
    const store = new SessionStore({ path: ":memory:" }).migrate()
    const sessionId = "ws:demo3"
    store.appendSession({ id: sessionId, workspaceId: "demo" })
    store.appendMessage({
      id: "a",
      sessionId,
      role: "assistant",
      content: JSON.stringify([{ type: "mcp_list_tools" }, message("m1")]),
    })
    const strict = store.replayMessages(sessionId)
    expect(JSON.parse(strict[0]!.content)).toHaveLength(1)
    expect(strict[0]!.sanitizeReport?.filtered).toBe(1)

    const lenient = store.replayMessages(sessionId, { table: { rules: [] } })
    expect(JSON.parse(lenient[0]!.content)).toHaveLength(2)
    store.close()
  })

  it("coexists with the hash chain: sanitization is a read-path projection", () => {
    const store = new SessionStore({ path: ":memory:" }).migrate()
    const sessionId = "ws:demo4"
    store.appendSession({ id: sessionId, workspaceId: "demo" })
    store.appendMessage({
      id: "a",
      sessionId,
      role: "assistant",
      content: JSON.stringify([call("c1"), output("c1")]),
    })
    expect(store.verifyHistory(sessionId)).toEqual({ ok: true })
    const rows = store.replayMessages(sessionId)
    expect(JSON.parse(rows[0]!.content)).toHaveLength(2)
    expect(store.verifyHistory(sessionId)).toEqual({ ok: true })
    store.close()
  })
})
