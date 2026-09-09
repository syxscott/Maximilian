// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

import { describe, it, expect } from "vitest"
import {
  RuntimeInterrupt,
  isRuntimeInterrupt,
  getInterruptInfo,
} from "../src/runtime-interrupt.js"

describe("RuntimeInterrupt", () => {
  it("creates an interrupt with reason and optional payload", () => {
    const interrupt = new RuntimeInterrupt("awaiting approval", { requestId: "abc" })
    expect(interrupt.reason).toBe("awaiting approval")
    expect(interrupt.payload).toEqual({ requestId: "abc" })
    expect(interrupt.message).toBe("interrupt: awaiting approval")
    expect(interrupt.name).toBe("RuntimeInterrupt")
  })

  it("payload is optional", () => {
    const interrupt = new RuntimeInterrupt("just pausing")
    expect(interrupt.payload).toBeUndefined()
  })

  it("is an instance of Error", () => {
    const interrupt = new RuntimeInterrupt("test")
    expect(interrupt instanceof Error).toBe(true)
    expect(interrupt instanceof RuntimeInterrupt).toBe(true)
  })

  it("has a stack trace", () => {
    const interrupt = new RuntimeInterrupt("test")
    expect(interrupt.stack).toBeDefined()
    expect(interrupt.stack).toContain("RuntimeInterrupt")
  })
})

describe("isRuntimeInterrupt", () => {
  it("returns true for RuntimeInterrupt", () => {
    const interrupt = new RuntimeInterrupt("test")
    expect(isRuntimeInterrupt(interrupt)).toBe(true)
  })

  it("returns false for plain Error", () => {
    expect(isRuntimeInterrupt(new Error("test"))).toBe(false)
  })

  it("returns false for null and undefined", () => {
    expect(isRuntimeInterrupt(null)).toBe(false)
    expect(isRuntimeInterrupt(undefined)).toBe(false)
  })

  it("returns false for non-error values", () => {
    expect(isRuntimeInterrupt("not an error")).toBe(false)
    expect(isRuntimeInterrupt({ reason: "test" })).toBe(false)
    expect(isRuntimeInterrupt({})).toBe(false)
  })
})

describe("getInterruptInfo", () => {
  it("extracts reason and payload", () => {
    const interrupt = new RuntimeInterrupt("waiting for input", { step: 1 })
    const info = getInterruptInfo(interrupt)
    expect(info.reason).toBe("waiting for input")
    expect(info.payload).toEqual({ step: 1 })
  })

  it("extracts reason without payload", () => {
    const interrupt = new RuntimeInterrupt("simple pause")
    const info = getInterruptInfo(interrupt)
    expect(info.reason).toBe("simple pause")
    expect(info.payload).toBeUndefined()
  })

  it("throws when passed a non-RuntimeInterrupt", () => {
    // @ts-expect-error — intentional wrong type for test
    expect(() => getInterruptInfo(new Error("not an interrupt"))).toThrow()
  })
})
