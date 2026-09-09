// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { SelfCritique } from "../src/self-critique.js"
import type { Provider, ChatResponse } from "@max/providers"

// Mock provider factory
function mockProvider(response: Partial<ChatResponse>): Provider {
  return {
    id: "mock",
    name: "Mock",
    defaultModel: "mock-model",
    chat: vi.fn().mockResolvedValue({
      content: JSON.stringify(response),
      model: "mock-model",
    } as ChatResponse),
    stream: vi.fn(),
    isConfigured: () => true,
  }
}

describe("SelfCritique", () => {
  describe("observe", () => {
    it("returns a critique result from the LLM", async () => {
      const provider = mockProvider({
        useful: true,
        score: 8,
        reason: "The action was effective",
        suggestions: ["Consider edge cases"],
      })
      const critique = new SelfCritique({ llm: provider })
      const result = await critique.observe(
        "search_files pattern=*.ts",
        "Found 5 TypeScript files",
        [],
      )
      expect(result.useful).toBe(true)
      expect(result.score).toBe(8)
      expect(result.reason).toBe("The action was effective")
      expect(result.suggestions).toEqual(["Consider edge cases"])
    })

    it("returns a neutral result when LLM response cannot be parsed", async () => {
      // Return a string that is not valid JSON at all
      const provider = {
        id: "mock",
        name: "Mock",
        defaultModel: "mock-model",
        chat: vi.fn().mockResolvedValue({
          content: "this is not parseable as JSON at all",
          model: "mock-model",
        }),
        stream: vi.fn(),
        isConfigured: () => true,
      } as unknown as Provider
      const critique = new SelfCritique({ llm: provider })
      const result = await critique.observe(
        "search_files pattern=*.ts",
        "Found 5 TypeScript files",
        [],
      )
      expect(result.score).toBe(5)
      expect(result.useful).toBe(true)
    })

    it("uses custom threshold", async () => {
      const provider = mockProvider({ useful: false, score: 4, reason: "bad" })
      const critique = new SelfCritique({ llm: provider, threshold: 5 })
      const result = await critique.observe("foo", "bar", [])
      expect(result.score).toBe(4)
    })
  })

  describe("shouldReplan", () => {
    it("returns false when results are too few", () => {
      const provider = mockProvider({ useful: false, score: 1, reason: "" })
      const critique = new SelfCritique({ llm: provider, threshold: 3 })
      // Only 1 result, threshold is 2
      expect(critique.shouldReplan([{ useful: false, score: 1, reason: "" }])).toBe(false)
    })

    it("returns true when consecutive results are below threshold", () => {
      const critique = new SelfCritique({ llm: mockProvider({}), threshold: 3 })
      const results = [
        { useful: false, score: 2, reason: "" },
        { useful: false, score: 1, reason: "" },
      ]
      expect(critique.shouldReplan(results, 2)).toBe(true)
    })

    it("returns false when some results are above threshold", () => {
      const critique = new SelfCritique({ llm: mockProvider({}), threshold: 3 })
      const results = [
        { useful: false, score: 2, reason: "" },
        { useful: true, score: 5, reason: "" },
      ]
      expect(critique.shouldReplan(results, 2)).toBe(false)
    })

    it("respects custom consecutive threshold", () => {
      const critique = new SelfCritique({ llm: mockProvider({}), threshold: 3 })
      const results = [
        { useful: false, score: 2, reason: "" },
        { useful: false, score: 1, reason: "" },
        { useful: false, score: 0, reason: "" },
      ]
      // With threshold=3, need 3 consecutive low scores
      expect(critique.shouldReplan(results, 3)).toBe(true)
      // With threshold=4, only 3 results is not enough
      expect(critique.shouldReplan(results.slice(0, 2), 3)).toBe(false)
    })
  })
})
