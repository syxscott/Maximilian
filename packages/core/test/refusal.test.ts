// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Refusal settlement semantics (deepseek chat-demo reply.ts settleReply /
 * canContinueReply / isUsableReply borrowing): a refused turn is terminal —
 * its partially streamed body is protocol-untrusted and must never continue
 * or re-enter the context as a trusted assistant turn.
 */
import { describe, expect, it } from "vitest"
import {
  REFUSAL_FINISH_REASON,
  REFUSED_RESULT_MARKER,
  annotateRefusalMarker,
  canContinueAfterRefusal,
  canContinueAsPrefix,
  isRefusalFinish,
  isRefusedMetadata,
  settleRefusal,
} from "../src/refusal.js"

describe("isRefusalFinish", () => {
  it("matches the canonical refusal finishReason", () => {
    expect(isRefusalFinish("refusal")).toBe(true)
    expect(isRefusalFinish(REFUSAL_FINISH_REASON)).toBe(true)
  })

  it("leaves every other finish reason alone", () => {
    expect(isRefusalFinish("stop")).toBe(false)
    expect(isRefusalFinish("end_turn")).toBe(false)
    expect(isRefusalFinish("max_tokens")).toBe(false)
    expect(isRefusalFinish("length")).toBe(false)
    expect(isRefusalFinish(undefined)).toBe(false)
    expect(isRefusalFinish("")).toBe(false)
  })
})

describe("settleRefusal", () => {
  it("flags the settlement and clears parsed tool calls (protocol-untrusted)", () => {
    const settled = settleRefusal({
      content: "partial answer that cannot be retracted",
      toolCalls: [{ id: "tc-1", name: "echo", input: { x: 1 } }],
      model: "m-1",
    })
    expect(settled.refused).toBe(true)
    expect(settled.toolCalls).toEqual([])
    expect(settled.model).toBe("m-1")
  })

  it("preserves the raw body for audit (no physical deletion)", () => {
    const settled = settleRefusal({ content: "partial answer", toolCalls: [] })
    expect(settled.content).toBe("partial answer")
    expect(settled.refused).toBe(true)
  })

  it("does not mutate the input response", () => {
    const original = { content: "partial", toolCalls: [{ id: "tc-1", name: "x", input: {} }] }
    settleRefusal(original)
    expect(original.toolCalls).toHaveLength(1)
    expect("refused" in original).toBe(false)
  })
})

describe("canContinueAfterRefusal", () => {
  it("is a protocol invariant: always false", () => {
    expect(canContinueAfterRefusal()).toBe(false)
  })
})

describe("canContinueAsPrefix (chat-demo canContinueReply port)", () => {
  it("a refused turn never continues (refusal leg → canContinueAfterRefusal)", () => {
    expect(canContinueAsPrefix({ stopReason: "refusal", content: "partial but untrusted" })).toBe(
      false,
    )
    expect(
      canContinueAsPrefix({ stopReason: "refusal", unsettledToolCalls: 0, content: "x" }),
    ).toBe(false)
  })

  it("an unfinished tool round disqualifies the assistant prefix", () => {
    expect(
      canContinueAsPrefix({
        stopReason: "stop",
        unsettledToolCalls: 1,
        content: "announced a tool",
      }),
    ).toBe(false)
  })

  it("errored turns never continue", () => {
    expect(canContinueAsPrefix({ stopReason: undefined, errored: true, content: "x" })).toBe(false)
  })

  it("an empty body has nothing to prefix (isUsableReply leg)", () => {
    expect(canContinueAsPrefix({ stopReason: "stop", content: "" })).toBe(false)
    expect(canContinueAsPrefix({ stopReason: "stop", content: "   " })).toBe(false)
    expect(canContinueAsPrefix({ stopReason: "stop" })).toBe(false)
  })

  it("a complete turn with a body qualifies as the context prefix", () => {
    expect(canContinueAsPrefix({ stopReason: "stop", content: "done" })).toBe(true)
    expect(canContinueAsPrefix({ stopReason: "end_turn", content: "done" })).toBe(true)
  })

  it("a token-truncated turn without tool rounds continues (chat-demo max_tokens leg)", () => {
    expect(canContinueAsPrefix({ stopReason: "max_tokens", content: "half-written" })).toBe(true)
    expect(canContinueAsPrefix({ stopReason: "length", content: "half-written" })).toBe(true)
  })
})

describe("isRefusedMetadata", () => {
  it("reads the refused marker from a Result.metadata record", () => {
    expect(isRefusedMetadata({ refused: true })).toBe(true)
    expect(isRefusedMetadata({ refused: false })).toBe(false)
    expect(isRefusedMetadata({ refused: "true" })).toBe(false)
    expect(isRefusedMetadata({ other: 1 })).toBe(false)
  })

  it("defends against non-object metadata (arbitrary key-value record seam)", () => {
    expect(isRefusedMetadata(undefined)).toBe(false)
    expect(isRefusedMetadata(null)).toBe(false)
    expect(isRefusedMetadata("refused")).toBe(false)
    expect(isRefusedMetadata(42)).toBe(false)
  })
})

describe("annotateRefusalMarker", () => {
  const refusedResult = (output: string, refused = true) => ({
    id: "r-1",
    output,
    metadata: refused ? { refused: true } : {},
  })

  it("prefixes the refused annotation aligned with the unverified-draft pattern", () => {
    const marked = annotateRefusalMarker(refusedResult("partial body"))
    expect(marked.output.startsWith(REFUSED_RESULT_MARKER)).toBe(true)
    expect(marked.output).toContain("partial body")
    expect(marked.output).toBe(`${REFUSED_RESULT_MARKER}\npartial body`)
  })

  it("is idempotent — layered callers never double-mark", () => {
    const once = annotateRefusalMarker(refusedResult("body"))
    const twice = annotateRefusalMarker(once)
    expect(twice.output).toBe(once.output)
    expect(twice.output.match(/refused — do not rely/g)).toHaveLength(1)
  })

  it("leaves non-refused results untouched", () => {
    const r = refusedResult("clean output", false)
    expect(annotateRefusalMarker(r)).toBe(r)
    expect(annotateRefusalMarker(r).output).toBe("clean output")
  })
})
