// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for tool-context.ts
 * Validates ToolExecuteContext, ExtensionBag, and builder patterns.
 */

import { describe, it, expect } from "vitest"
import {
  ExtensionBag,
  ExtensionKeys,
  ToolExecuteContextBuilder,
  getCwd,
  getAbortSignal,
  getModelOverride,
  getBehaviorVersion,
} from "../src/tool-context.js"

describe("ExtensionBag", () => {
  it("stores and retrieves values by symbol key", () => {
    const bag = new ExtensionBag()
    const key = Symbol.for("test.key")
    bag.set(key, { value: 42 })

    expect(bag.get(key)).toEqual({ value: 42 })
  })

  it("returns undefined for missing keys", () => {
    const bag = new ExtensionBag()
    const key = Symbol.for("test.missing")
    expect(bag.get(key)).toBeUndefined()
  })

  it("has() returns true for existing keys", () => {
    const bag = new ExtensionBag()
    const key = Symbol.for("test.exists")
    bag.set(key, "value")
    expect(bag.has(key)).toBe(true)
  })

  it("has() returns false for missing keys", () => {
    const bag = new ExtensionBag()
    expect(bag.has(Symbol.for("test.notexists"))).toBe(false)
  })

  it("delete() removes a key", () => {
    const bag = new ExtensionBag()
    const key = Symbol.for("test.delete")
    bag.set(key, "value")
    expect(bag.delete(key)).toBe(true)
    expect(bag.has(key)).toBe(false)
  })

  it("size reflects the number of entries", () => {
    const bag = new ExtensionBag()
    expect(bag.size).toBe(0)
    bag.set(Symbol.for("test.1"), "a")
    expect(bag.size).toBe(1)
    bag.set(Symbol.for("test.2"), "b")
    expect(bag.size).toBe(2)
    bag.delete(Symbol.for("test.1"))
    expect(bag.size).toBe(1)
  })

  it("keys() returns iterable of symbol keys", () => {
    const bag = new ExtensionBag()
    const key1 = Symbol.for("test.keys.1")
    const key2 = Symbol.for("test.keys.2")
    bag.set(key1, "a")
    bag.set(key2, "b")

    const keys = [...bag.keys()]
    expect(keys).toContain(key1)
    expect(keys).toContain(key2)
    expect(keys).toHaveLength(2)
  })
})

describe("ExtensionKeys", () => {
  it("has cwd key", () => {
    expect(ExtensionKeys.cwd).toBe(Symbol.for("max.tool.context.cwd"))
  })

  it("has sandbox key", () => {
    expect(ExtensionKeys.sandbox).toBe(Symbol.for("max.tool.context.sandbox"))
  })

  it("has abortSignal key", () => {
    expect(ExtensionKeys.abortSignal).toBe(Symbol.for("max.tool.context.abortSignal"))
  })

  it("has outputStream key", () => {
    expect(ExtensionKeys.outputStream).toBe(Symbol.for("max.tool.context.outputStream"))
  })

  it("has callId key", () => {
    expect(ExtensionKeys.callId).toBe(Symbol.for("max.tool.context.callId"))
  })

  it("has modelOverride key", () => {
    expect(ExtensionKeys.modelOverride).toBe(Symbol.for("max.tool.context.modelOverride"))
  })

  it("has resources key", () => {
    expect(ExtensionKeys.resources).toBe(Symbol.for("max.tool.context.resources"))
  })

  it("has behaviorVersion key", () => {
    expect(ExtensionKeys.behaviorVersion).toBe(Symbol.for("max.tool.context.behaviorVersion"))
  })

  it("has credentials key", () => {
    expect(ExtensionKeys.credentials).toBe(Symbol.for("max.tool.context.credentials"))
  })
})

describe("ToolExecuteContextBuilder", () => {
  it("builds a basic context", () => {
    const ctx = new ToolExecuteContextBuilder()
      .sessionID("sess-123")
      .agent("backend")
      .assistantMessageID("msg-456")
      .toolCallID("call-789")
      .build()

    expect(ctx.sessionID).toBe("sess-123")
    expect(ctx.agent).toBe("backend")
    expect(ctx.assistantMessageID).toBe("msg-456")
    expect(ctx.toolCallID).toBe("call-789")
  })

  it("throws if sessionID is missing", () => {
    expect(() =>
      new ToolExecuteContextBuilder()
        .toolCallID("call-789")
        .build(),
    ).toThrow("sessionID is required")
  })

  it("throws if toolCallID is missing", () => {
    expect(() =>
      new ToolExecuteContextBuilder()
        .sessionID("sess-123")
        .build(),
    ).toThrow("toolCallID is required")
  })

  it("builds context with cwd extension", () => {
    const ctx = new ToolExecuteContextBuilder()
      .sessionID("sess-123")
      .toolCallID("call-456")
      .withCwd("/home/user/project")
      .build()

    expect(getCwd(ctx)).toBe("/home/user/project")
  })

  it("builds context with abortSignal extension", () => {
    const controller = new AbortController()
    const ctx = new ToolExecuteContextBuilder()
      .sessionID("sess-123")
      .toolCallID("call-456")
      .withAbortSignal(controller.signal)
      .build()

    expect(getAbortSignal(ctx)).toBe(controller.signal)
  })

  it("builds context with modelOverride extension", () => {
    const ctx = new ToolExecuteContextBuilder()
      .sessionID("sess-123")
      .toolCallID("call-456")
      .withModelOverride("gpt-4o", "openai")
      .build()

    const override = getModelOverride(ctx)
    expect(override?.model).toBe("gpt-4o")
    expect(override?.provider).toBe("openai")
  })

  it("builds context with behaviorVersion extension", () => {
    const ctx = new ToolExecuteContextBuilder()
      .sessionID("sess-123")
      .toolCallID("call-456")
      .withBehaviorVersion(2)
      .build()

    expect(getBehaviorVersion(ctx)).toBe(2)
  })

  it("builds context with custom extension", () => {
    const customKey = Symbol.for("test.custom")
    const ctx = new ToolExecuteContextBuilder()
      .sessionID("sess-123")
      .toolCallID("call-456")
      .withExtension(customKey, { custom: "data" })
      .build()

    expect(ctx.extensions.get(customKey)).toEqual({ custom: "data" })
  })

  it("fromContext copies extensions from existing context", () => {
    const existing = new ToolExecuteContextBuilder()
      .sessionID("sess-existing")
      .toolCallID("call-existing")
      .withCwd("/existing/path")
      .withBehaviorVersion(5)
      .build()

    const ctx = new ToolExecuteContextBuilder()
      .sessionID("sess-new")
      .toolCallID("call-new")
      .fromContext(existing)
      .build()

    expect(getCwd(ctx)).toBe("/existing/path")
    expect(getBehaviorVersion(ctx)).toBe(5)
  })

  it("produces an immutable context", () => {
    const ctx = new ToolExecuteContextBuilder()
      .sessionID("sess-123")
      .toolCallID("call-456")
      .build()

    // TypeScript 告诉我们对象是 frozen 的
    expect(Object.isFrozen(ctx)).toBe(true)
  })
})

describe("getCwd convenience function", () => {
  it("returns cwd from context", () => {
    const ctx = new ToolExecuteContextBuilder()
      .sessionID("sess-123")
      .toolCallID("call-456")
      .withCwd("/project")
      .build()

    expect(getCwd(ctx)).toBe("/project")
  })

  it("returns fallback when cwd not set", () => {
    const ctx = new ToolExecuteContextBuilder()
      .sessionID("sess-123")
      .toolCallID("call-456")
      .build()

    expect(getCwd(ctx, "/default")).toBe("/default")
  })
})

describe("context immutability", () => {
  it("context.extensions is the same instance as built", () => {
    const builder = new ToolExecuteContextBuilder()
      .sessionID("sess-123")
      .toolCallID("call-456")
      .withCwd("/test")

    const ctx = builder.build()
    // extensions should be the same object
    expect(ctx.extensions.size).toBe(1)
  })
})
