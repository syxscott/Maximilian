import { describe, it, expect } from "vitest"
import { AgentMemoryStore } from "../src/memory.js"
import { emptyMemory, MemoryMime, toMemoryEntry } from "../src/types.js"

describe("AgentMemory MIME types", () => {
  it("wraps raw strings in text/plain entries", () => {
    const entry = toMemoryEntry("hello", MemoryMime.TextPlain)
    expect(entry).toEqual({ mime: "text/plain", content: "hello", metadata: undefined })
  })

  it("preserves the mime when coercing structured data", () => {
    const entry = toMemoryEntry({ foo: 1 }, MemoryMime.ApplicationJson)
    expect(entry.mime).toBe("application/json")
    expect(JSON.parse(entry.content)).toEqual({ foo: 1 })
  })

  it("round-trips an already-typed entry", () => {
    const original = { mime: "image/png", content: "base64-data", metadata: { width: 32 } }
    const entry = toMemoryEntry(original)
    expect(entry).toEqual(original)
  })

  it("records structured payloads with application/json mime", () => {
    const mem = AgentMemoryStore.recordStructured(
      emptyMemory(),
      "reviewSuggestions",
      { issues: ["x"], score: 7 },
      { source: "reviewer-v1" },
    )
    const last = mem.reviewSuggestions.at(-1)!
    expect(last.mime).toBe("application/json")
    expect(JSON.parse(last.content)).toEqual({ issues: ["x"], score: 7 })
    expect(last.metadata).toEqual({ source: "reviewer-v1" })
  })

  it("prelude joins only the .content field of entries", () => {
    let mem = emptyMemory()
    mem = AgentMemoryStore.recordFeedback(mem, "use TypeScript")
    mem = AgentMemoryStore.recordFeedback(mem, "add tests")
    const prelude = AgentMemoryStore.toPrelude(mem)
    expect(prelude).toContain("use TypeScript")
    expect(prelude).toContain("add tests")
    expect(prelude).not.toContain("text/plain")
  })
})