import { describe, it, expect } from "vitest"
import { cascadeSettings, mergeSettings, resolveSetting } from "../src/cascade.js"

describe("mergeSettings", () => {
  it("replaces primitives from overrides", () => {
    expect(mergeSettings({ a: 1 }, { a: 2 })).toEqual({ a: 2 })
  })

  it("replaces arrays wholesale (no element merge)", () => {
    expect(mergeSettings({ tags: ["a", "b"] }, { tags: ["c"] })).toEqual({ tags: ["c"] })
  })

  it("recurses one level into nested objects", () => {
    const base = { ui: { theme: "dark", font: "sans" } }
    const over = { ui: { theme: "light" } }
    expect(mergeSettings(base, over)).toEqual({ ui: { theme: "light", font: "sans" } })
  })

  it("returns a new object when overrides is undefined", () => {
    const base = { a: 1 }
    const merged = mergeSettings(base, undefined)
    expect(merged).toEqual(base)
    expect(merged).not.toBe(base)
  })

  it("does not mutate the base", () => {
    const base = { a: { b: 1 } }
    mergeSettings(base, { a: { b: 2 } })
    expect(base).toEqual({ a: { b: 1 } })
  })
})

describe("cascadeSettings", () => {
  it("session wins over project, user, and defaults", () => {
    const out = cascadeSettings(
      { model: "gpt-4o", temperature: 0.7 },
      { model: "gpt-4o-mini" },
      { model: "claude-sonnet-4" },
      { temperature: 0.1 },
    )
    expect(out).toEqual({ model: "claude-sonnet-4", temperature: 0.1 })
  })

  it("missing layers are skipped", () => {
    const out = cascadeSettings({ a: 1 }, undefined, { b: 2 }, undefined)
    expect(out).toEqual({ a: 1, b: 2 })
  })

  it("deep merges across all three layers", () => {
    const out = cascadeSettings(
      { provider: { openai: { model: "gpt-4o" } } },
      { provider: { openai: { temperature: 0.5 } } },
      { provider: { openai: { temperature: 0.2 } } },
    )
    expect(out).toEqual({
      provider: { openai: { model: "gpt-4o", temperature: 0.2 } },
    })
  })
})

describe("resolveSetting", () => {
  it("walks from most-specific to least-specific layer", () => {
    const v = resolveSetting<string>(
      "theme",
      { theme: "dark" },
      { theme: "light" },
      undefined,
    )
    expect(v).toBe("light")
  })

  it("returns undefined when none of the layers define the key", () => {
    expect(resolveSetting("missing", { a: 1 }, { b: 2 })).toBeUndefined()
  })
})