// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Self-consistency gate for token usage (OpenAgentCore sessions/usage.go
 * MeasuredUsage borrowing).
 *
 * Contract under test: a usage breakdown is trusted ONLY when every counter
 * is present and non-negative, cached tokens fit inside input (inclusive
 * semantics), reasoning tokens fit inside output and the total equals
 * input + output. Anything else is UNKNOWN — `null` / `undefined` — never
 * zero-filled or partially-trusted accounting.
 */
import { describe, expect, it } from "vitest"
import { measuredUsage, gateUsageShape } from "../src/usage.js"

/** A complete, consistent, all-zero record — the minimal valid measurement. */
const zeroRecord = {
  input_tokens: 0,
  output_tokens: 0,
  total_tokens: 0,
  cached_input_tokens: 0,
  cache_creation_input_tokens: 0,
  reasoning_output_tokens: 0,
}

describe("measuredUsage — acceptance", () => {
  it("accepts a complete consistent record (explicit zeros are measurements)", () => {
    expect(
      measuredUsage({
        input_tokens: 100,
        output_tokens: 40,
        total_tokens: 140,
        cached_input_tokens: 30,
        cache_creation_input_tokens: 0,
        reasoning_output_tokens: 12,
      }),
    ).toEqual({
      inputTokens: 100,
      outputTokens: 40,
      totalTokens: 140,
      cachedInputTokens: 30,
      cacheCreationTokens: 0,
      reasoningOutputTokens: 12,
    })
  })

  it("accepts camelCase aliases", () => {
    expect(
      measuredUsage({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        cacheReadTokens: 2,
        cacheCreationTokens: 0,
        reasoningTokens: 1,
      }),
    ).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      cachedInputTokens: 2,
      cacheCreationTokens: 0,
      reasoningOutputTokens: 1,
    })
  })

  it("waives cached ≤ input for exclusive (Anthropic-style) semantics", () => {
    // Anthropic reports cache reads OUTSIDE input_tokens: 900 cached +
    // 100 fresh input is a healthy measurement, not an inconsistency.
    expect(
      measuredUsage(
        {
          input_tokens: 100,
          output_tokens: 40,
          total_tokens: 140,
          cached_input_tokens: 900,
          cache_creation_input_tokens: 50,
          reasoning_output_tokens: 0,
        },
        { cacheSemantics: "exclusive" },
      ),
    ).not.toBeNull()
  })

  it("rejects non-object and array records", () => {
    expect(measuredUsage(null)).toBeNull()
    expect(measuredUsage(42)).toBeNull()
    expect(measuredUsage("usage")).toBeNull()
    expect(measuredUsage([1, 2, 3])).toBeNull()
  })
})

describe("measuredUsage — rejection (inconsistent accounting becomes unknown)", () => {
  const good = {
    input_tokens: 100,
    output_tokens: 40,
    total_tokens: 140,
    cached_input_tokens: 30,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 12,
  }

  it("rejects cached > input (inclusive semantics)", () => {
    expect(measuredUsage({ ...good, cached_input_tokens: 101 })).toBeNull()
  })

  it("rejects total ≠ input + output", () => {
    expect(measuredUsage({ ...good, total_tokens: 139 })).toBeNull()
    expect(measuredUsage({ ...good, total_tokens: 141 })).toBeNull()
  })

  it("rejects reasoning > output", () => {
    expect(measuredUsage({ ...good, reasoning_output_tokens: 41 })).toBeNull()
  })

  it("rejects negative counters", () => {
    for (const key of [
      "input_tokens",
      "output_tokens",
      "total_tokens",
      "cached_input_tokens",
      "cache_creation_input_tokens",
      "reasoning_output_tokens",
    ]) {
      expect(measuredUsage({ ...good, [key]: -1 })).toBeNull()
    }
  })

  it("rejects missing fields", () => {
    for (const key of [
      "input_tokens",
      "output_tokens",
      "total_tokens",
      "cached_input_tokens",
      "cache_creation_input_tokens",
      "reasoning_output_tokens",
    ]) {
      const partial: Record<string, number> = { ...good }
      delete partial[key]
      expect(measuredUsage(partial), `missing ${key}`).toBeNull()
    }
  })

  it("rejects non-numeric garbage in a counter", () => {
    expect(measuredUsage({ ...good, input_tokens: "many" })).toBeNull()
  })
})

describe("gateUsageShape — ChatResponse/ChatChunk consumption seam", () => {
  it("maps a consistent OpenAI-style wire record (cache folded into input)", () => {
    expect(
      gateUsageShape({
        prompt_tokens: 1000,
        completion_tokens: 200,
        total_tokens: 1200,
        prompt_tokens_details: { cached_tokens: 800 },
        completion_tokens_details: { reasoning_tokens: 60 },
      }),
    ).toEqual({
      promptTokens: 1000,
      completionTokens: 200,
      totalTokens: 1200,
      cacheReadTokens: 800,
      cacheCreationTokens: 0,
      reasoningTokens: 60,
    })
  })

  it("derives the total when the wire does not carry one (Anthropic)", () => {
    expect(
      gateUsageShape(
        {
          input_tokens: 100,
          output_tokens: 40,
          cache_read_input_tokens: 900,
          cache_creation_input_tokens: 50,
        },
        { cacheSemantics: "exclusive" },
      ),
    ).toEqual({
      promptTokens: 100,
      completionTokens: 40,
      totalTokens: 140,
      cacheReadTokens: 900,
      cacheCreationTokens: 50,
      reasoningTokens: 0,
    })
  })

  it("fills absent optional counters with explicit zeros", () => {
    expect(gateUsageShape({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 })).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      reasoningTokens: 0,
    })
  })

  it("returns undefined (unknown) on cached > input", () => {
    expect(
      gateUsageShape({
        prompt_tokens: 100,
        completion_tokens: 40,
        total_tokens: 140,
        prompt_tokens_details: { cached_tokens: 200 },
      }),
    ).toBeUndefined()
  })

  it("returns undefined on a reported total that is not the sum", () => {
    expect(
      gateUsageShape({ prompt_tokens: 100, completion_tokens: 40, total_tokens: 999 }),
    ).toBeUndefined()
  })

  it("returns undefined on negative or missing core counters", () => {
    expect(
      gateUsageShape({ prompt_tokens: -5, completion_tokens: 4, total_tokens: -1 }),
    ).toBeUndefined()
    expect(gateUsageShape({ completion_tokens: 4, total_tokens: 4 })).toBeUndefined()
    expect(gateUsageShape(null)).toBeUndefined()
    expect(gateUsageShape("garbage")).toBeUndefined()
  })

  it("returns undefined on reasoning > output", () => {
    expect(
      gateUsageShape({
        prompt_tokens: 100,
        completion_tokens: 40,
        total_tokens: 140,
        completion_tokens_details: { reasoning_tokens: 50 },
      }),
    ).toBeUndefined()
  })
})
