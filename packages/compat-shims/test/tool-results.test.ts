// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Orphan tool-result sanitizer tests (cc-switch `2b0ec81b` + `9055dd37`):
 *   - Responses path: missing/blank call_id rewritten into a marked user
 *     message at the original position, text/image parts preserved, paired
 *     outputs untouched, orphans between parallel results staged to the
 *     turn boundary, clean history unchanged.
 *   - Chat path: missing/blank/never-announced tool_call_id demoted to a
 *     marked user message, paired messages untouched, tool runs kept
 *     contiguous, clean history unchanged.
 *   - Both paths share one marker constant.
 */

import { describe, it, expect } from "vitest"
import {
  ORPHAN_TOOL_OUTPUT_MARKER,
  sanitizeResponsesInput,
  sanitizeChatMessages,
} from "../src/tool-results.js"

describe("ORPHAN_TOOL_OUTPUT_MARKER", () => {
  it("is the single shared wording both conversion paths use", () => {
    expect(ORPHAN_TOOL_OUTPUT_MARKER).toBe("[tool_result without a matching tool_call]")
  })
})

describe("sanitizeResponsesInput", () => {
  it("rewrites a call_id-less function_call_output at its original index", () => {
    // Shape a desktop client injects for a create_thread receipt: an id,
    // call_id null, no preceding function_call.
    const result = sanitizeResponsesInput([
      { type: "message", role: "user", content: [{ type: "input_text", text: "go" }] },
      { type: "function_call", call_id: "call_1", name: "shell", arguments: "{}" },
      {
        type: "function_call_output",
        id: "fco_01abc",
        call_id: null,
        output: "Created thread t_42: review the PR",
      },
      { type: "function_call_output", call_id: "call_1", output: "ok" },
    ])

    expect(result.changed).toBe(true)
    expect(result.items).toHaveLength(4)
    // The orphan is staged until the result run ends, so the paired output
    // stays at index 2 and the demoted receipt lands after it.
    expect(result.items[2]).toEqual({
      type: "function_call_output",
      call_id: "call_1",
      output: "ok",
    })
    expect(result.items[3]).toEqual({
      type: "message",
      role: "user",
      content: [
        {
          type: "input_text",
          text: `${ORPHAN_TOOL_OUTPUT_MARKER}\nCreated thread t_42: review the PR`,
        },
      ],
    })
    // Paired call is untouched.
    expect(result.items[1]).toEqual({
      type: "function_call",
      call_id: "call_1",
      name: "shell",
      arguments: "{}",
    })
  })

  it("rewrites missing and blank call ids but keeps any present call id", () => {
    const result = sanitizeResponsesInput([
      { type: "function_call_output", id: "fco_1", output: "automation" },
      { type: "function_call_output", call_id: "   ", output: "heartbeat" },
      // Paired through previous_response_id, not through this input array.
      { type: "function_call_output", call_id: "call_prev", output: "kept" },
    ])

    // All three are tool results, so the pair stays contiguous and the
    // staged orphans land when the run ends.
    expect(result.items[0]).toEqual({
      type: "function_call_output",
      call_id: "call_prev",
      output: "kept",
    })
    expect(result.items[1]).toMatchObject({ type: "message", role: "user" })
    expect(result.items[2]).toMatchObject({ type: "message", role: "user" })
  })

  it("keeps image parts and JSON-serializes unknown part types", () => {
    const image = { type: "input_image", image_url: "data:image/png;base64,AAAA" }
    const result = sanitizeResponsesInput([
      {
        type: "function_call_output",
        output: [{ type: "input_text", text: "screenshot" }, image, { type: "unknown_part", x: 1 }],
      },
    ])

    expect(result.changed).toBe(true)
    const content = (result.items[0] as { content: unknown[] }).content
    expect(content).toHaveLength(4)
    expect(content[0]).toEqual({ type: "input_text", text: ORPHAN_TOOL_OUTPUT_MARKER })
    expect(content[1]).toEqual({ type: "input_text", text: "screenshot" })
    expect(content[2]).toBe(image) // preserved verbatim, same reference
    expect(content[3]).toEqual({
      type: "input_text",
      text: JSON.stringify({ type: "unknown_part", x: 1 }),
    })
  })

  it("handles empty string, null, and object outputs", () => {
    const result = sanitizeResponsesInput([
      { type: "function_call_output", output: "" },
      { type: "function_call_output", output: null },
      { type: "function_call_output", output: { receipt: true } },
    ])

    const first = (result.items[0] as { content: unknown[] }).content
    expect(first).toEqual([{ type: "input_text", text: ORPHAN_TOOL_OUTPUT_MARKER }])
    const second = (result.items[1] as { content: unknown[] }).content
    expect(second).toEqual([{ type: "input_text", text: ORPHAN_TOOL_OUTPUT_MARKER }])
    const third = (result.items[2] as { content: unknown[] }).content
    expect(third).toEqual([
      {
        type: "input_text",
        text: `${ORPHAN_TOOL_OUTPUT_MARKER}\n${JSON.stringify({ receipt: true })}`,
      },
    ])
  })

  it("stages orphans between parallel results and flushes at the turn boundary", () => {
    const result = sanitizeResponsesInput([
      { type: "function_call", call_id: "c1", name: "a", arguments: "{}" },
      { type: "function_call", call_id: "c2", name: "b", arguments: "{}" },
      { type: "function_call_output", call_id: "c1", output: "one" },
      { type: "function_call_output", output: "orphan receipt" },
      { type: "function_call_output", call_id: "c2", output: "two" },
      { type: "message", role: "user", content: [{ type: "input_text", text: "next" }] },
    ])

    expect(result.changed).toBe(true)
    // The result run stays contiguous; the orphan lands at its end.
    expect((result.items[2] as { type: string }).type).toBe("function_call_output")
    expect((result.items[3] as { type: string }).type).toBe("function_call_output")
    expect(result.items[4]).toMatchObject({ type: "message", role: "user" })
    expect(result.items[5]).toMatchObject({ type: "message", role: "user" })
  })

  it("flushes a trailing orphan at the end of input", () => {
    const result = sanitizeResponsesInput([
      { type: "function_call_output", output: "tail receipt" },
    ])
    expect(result.changed).toBe(true)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ type: "message", role: "user" })
  })

  it("leaves clean paired history unchanged and unmutated", () => {
    const input = [
      { type: "message", role: "user", content: [{ type: "input_text", text: "go" }] },
      { type: "function_call", call_id: "c1", name: "shell", arguments: "{}" },
      { type: "function_call_output", call_id: "c1", output: "ok" },
    ]
    const result = sanitizeResponsesInput(input)
    expect(result.changed).toBe(false)
    expect(result.items).toEqual(input)
    // Purity: the input array and its entries are untouched.
    expect(input[2]).toEqual({ type: "function_call_output", call_id: "c1", output: "ok" })
  })

  it("is idempotent — a sanitized input sanitizes to itself", () => {
    const once = sanitizeResponsesInput([{ type: "function_call_output", output: "receipt" }]).items
    const twice = sanitizeResponsesInput(once)
    expect(twice.changed).toBe(false)
    expect(twice.items).toEqual(once)
  })
})

describe("sanitizeChatMessages", () => {
  it("demotes a tool message with no tool_call_id to a marked user message", () => {
    const result = sanitizeChatMessages([
      { role: "user", content: "hi" },
      {
        role: "assistant",
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "shell", arguments: "{}" } },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: "paired" },
      { role: "tool", content: "orphan delegation receipt" },
    ])

    expect(result.changed).toBe(true)
    expect(result.items[3]).toEqual({
      role: "user",
      content: `${ORPHAN_TOOL_OUTPUT_MARKER}\norphan delegation receipt`,
    })
    // Every remaining message avoids role=tool for the orphan.
    expect((result.items[3] as { role: string }).role).toBe("user")
    expect(result.items[2]).toEqual({ role: "tool", tool_call_id: "call_1", content: "paired" })
  })

  it("demotes blank and never-announced tool_call_ids with a call_id suffix", () => {
    const result = sanitizeChatMessages([
      { role: "assistant", content: "working" },
      { role: "tool", tool_call_id: "   ", content: "blank id" },
      { role: "tool", tool_call_id: "call_missing", content: "stale result" },
    ])

    expect(result.items[1]).toEqual({
      role: "user",
      content: `${ORPHAN_TOOL_OUTPUT_MARKER}\nblank id`,
    })
    expect(result.items[2]).toEqual({
      role: "user",
      content: `${ORPHAN_TOOL_OUTPUT_MARKER} (call_id: call_missing)\nstale result`,
    })
  })

  it("stages orphans so a parallel tool run is never split into tool,user,tool", () => {
    const result = sanitizeChatMessages([
      {
        role: "assistant",
        tool_calls: [
          { id: "c1", type: "function", function: { name: "a", arguments: "{}" } },
          { id: "c2", type: "function", function: { name: "b", arguments: "{}" } },
        ],
      },
      { role: "tool", tool_call_id: "c1", content: "one" },
      { role: "tool", content: "orphan" },
      { role: "tool", tool_call_id: "c2", content: "two" },
    ])

    expect(result.changed).toBe(true)
    // tool, tool stay adjacent; the demoted user message lands after the run.
    expect((result.items[1] as { role: string }).role).toBe("tool")
    expect((result.items[2] as { role: string }).role).toBe("tool")
    expect((result.items[3] as { role: string }).role).toBe("user")
  })

  it("preserves array content with image parts", () => {
    const imagePart = { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }
    const result = sanitizeChatMessages([
      { role: "tool", content: [{ type: "text", text: "screenshot" }, imagePart] },
    ])

    expect(result.items[0]).toEqual({
      role: "user",
      content: [
        { type: "text", text: ORPHAN_TOOL_OUTPUT_MARKER },
        { type: "text", text: "screenshot" },
        imagePart,
      ],
    })
  })

  it("registers tool_call ids only from earlier assistant messages", () => {
    // A later assistant message must not legitimize an earlier orphan.
    const result = sanitizeChatMessages([
      { role: "tool", tool_call_id: "call_late", content: "early orphan" },
      {
        role: "assistant",
        tool_calls: [
          { id: "call_late", type: "function", function: { name: "x", arguments: "{}" } },
        ],
      },
    ])

    expect(result.changed).toBe(true)
    expect((result.items[0] as { role: string }).role).toBe("user")
    expect((result.items[1] as { role: string }).role).toBe("assistant")
  })

  it("leaves clean paired history unchanged", () => {
    const input = [
      { role: "user", content: "hi" },
      {
        role: "assistant",
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "shell", arguments: "{}" } },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: "ok" },
      { role: "assistant", content: "done" },
    ]
    const result = sanitizeChatMessages(input)
    expect(result.changed).toBe(false)
    expect(result.items).toEqual(input)
  })
})
