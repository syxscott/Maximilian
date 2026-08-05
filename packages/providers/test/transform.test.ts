import { describe, it, expect, beforeAll } from "vitest"
import {
  registerTransformer,
  getTransformer,
  listTransformers,
  anthropicTransformer,
  openaiTransformer,
  type Transformer,
} from "../src/formats/transform.js"

beforeAll(() => {
  // ensure defaults are registered even if module loaded in different order
  if (!getTransformer("anthropic")) registerTransformer(anthropicTransformer)
  if (!getTransformer("openai")) registerTransformer(openaiTransformer)
})

describe("ProviderTransform registry (借鉴 opencode)", () => {
  it("anthropic + openai registered by default", () => {
    expect(getTransformer("anthropic")).toBeDefined()
    expect(getTransformer("openai")).toBeDefined()
  })

  it("listTransformers returns registered ids", () => {
    const ids = listTransformers()
    expect(ids).toContain("anthropic")
    expect(ids).toContain("openai")
  })

  it("anthropic.toWire produces systemBlocks with cache_control", () => {
    const t = getTransformer("anthropic")!
    const wire = t.toWire([], [], "hi")
    const block = wire.systemBlocks[0] as { cache_control?: { type: string } }
    expect(block.cache_control?.type).toBe("ephemeral")
  })

  it("anthropic.toWire passes messages through with role/content", () => {
    const t = getTransformer("anthropic")!
    const wire = t.toWire(
      [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ],
      [],
      "system",
    )
    expect(wire.messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ])
  })

  it("anthropic tools use input_schema (not parameters)", () => {
    const t = getTransformer("anthropic")!
    const wire = t.toWire(
      [],
      [
        {
          name: "read",
          description: "Read file",
          inputSchema: { type: "object" },
        } as any,
      ],
      "",
    )
    expect((wire.tools[0] as any).input_schema).toBeDefined()
    expect((wire.tools[0] as any).parameters).toBeUndefined()
  })

  it("openai.toWire wraps tools in {type:function,function:{...}}", () => {
    const t = getTransformer("openai")!
    const wire = t.toWire(
      [],
      [
        {
          name: "read",
          description: "Read",
          inputSchema: { type: "object" },
        } as any,
      ],
      "system",
    )
    expect((wire.tools[0] as any).type).toBe("function")
    expect((wire.tools[0] as any).function.name).toBe("read")
  })

  it("openai systemBlocks is an array with role:system", () => {
    const t = getTransformer("openai")!
    const wire = t.toWire([], [], "system-msg")
    expect((wire.systemBlocks[0] as any).role).toBe("system")
    expect((wire.systemBlocks[0] as any).content).toBe("system-msg")
  })

  it("custom transformer can be registered", () => {
    const custom: Transformer = {
      providerId: "custom-test",
      toWire: (msgs) => ({
        systemBlocks: [],
        messages: msgs.map((m) => ({ ...m, custom: true })),
        tools: [],
      }),
    }
    registerTransformer(custom)
    const t = getTransformer("custom-test")!
    const wire = t.toWire([{ role: "user", content: "x" }], [], "")
    expect((wire.messages[0] as any).custom).toBe(true)
    expect(listTransformers()).toContain("custom-test")
  })

  it("getTransformer returns undefined for unknown id", () => {
    expect(getTransformer("nonexistent")).toBeUndefined()
  })
})