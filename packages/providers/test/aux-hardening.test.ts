// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for aux-call hardening (hermes borrowing): CapabilityMemo,
 * FallbackCooldown, mergeAdjacentSameRole.
 */
import { describe, it, expect } from "vitest"
import {
  CapabilityMemo,
  FallbackCooldown,
  mergeAdjacentSameRole,
  isRoleAlternationError,
} from "../src/aux-hardening.js"

describe("CapabilityMemo", () => {
  it("scopes rejections by model", () => {
    const memo = new CapabilityMemo()
    memo.recordRejection("api.x/model-a", "response_format")
    expect(memo.isUnsupported("api.x/model-a", "response_format")).toBe(true)
    expect(memo.isUnsupported("api.x/model-b", "response_format")).toBe(false)
    expect(memo.isUnsupported("api.x/model-a", "tool_choice")).toBe(false)
  })
})

describe("FallbackCooldown", () => {
  it("arms exponentially and caps", () => {
    let t = 1_000
    const cooldown = new FallbackCooldown(60_000, 4 * 60 * 60_000, () => t)
    expect(cooldown.isCooling("p")).toBe(false)
    expect(cooldown.arm("p")).toBe(60_000)
    expect(cooldown.isCooling("p")).toBe(true)
    t += 61_000
    expect(cooldown.arm("p")).toBe(120_000) // escalate
    t += 121_000
    expect(cooldown.arm("p")).toBe(240_000)
  })

  it("disarms", () => {
    const cooldown = new FallbackCooldown(60_000, 4 * 60 * 60_000)
    cooldown.arm("p")
    cooldown.disarm("p")
    expect(cooldown.isCooling("p")).toBe(false)
  })
})

describe("mergeAdjacentSameRole", () => {
  it("merges adjacent same-role messages, keeps others", () => {
    const merged = mergeAdjacentSameRole([
      { role: "system", content: "sys" },
      { role: "user", content: "a" },
      { role: "user", content: "b" },
      { role: "assistant", content: "c" },
      { role: "user", content: "d" },
    ])
    expect(merged).toHaveLength(4)
    expect(merged[1]).toEqual({ role: "user", content: "a\n\nb" })
    expect(merged[3]).toEqual({ role: "user", content: "d" })
  })

  it("preserves non-string content blocks untouched", () => {
    const complex = { role: "user", content: [{ type: "text", text: "block" }] } as unknown as {
      role: string
      content: string
    }
    const merged = mergeAdjacentSameRole([complex, { role: "user", content: "x" }])
    expect(merged).toHaveLength(2) // cannot merge block content — pushed as-is
  })

  it("isRoleAlternationError matches template 400s", () => {
    expect(isRoleAlternationError("messages must alternate between user and assistant roles")).toBe(
      true,
    )
    expect(isRoleAlternationError("consecutive messages with same role")).toBe(true)
    expect(isRoleAlternationError("invalid api key")).toBe(false)
  })
})
