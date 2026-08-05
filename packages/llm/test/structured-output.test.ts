import { describe, it, expect } from "vitest"
import { z } from "zod"
import {
  structuredOutputTool,
  isStructuredOutputCall,
} from "../src/tool.js"

describe("StructuredOutput tool (借鉴 opencode)", () => {
  const Schema = z.object({
    answer: z.string(),
    score: z.number().min(0).max(1),
  })

  it("parses valid input via zod schema", async () => {
    const t = structuredOutputTool("final", Schema)
    await expect(
      t.execute({ answer: "ok", score: 0.9 }),
    ).resolves.toEqual({ answer: "ok", score: 0.9 })
  })

  it("throws ZodError on invalid input", async () => {
    const t = structuredOutputTool("final", Schema)
    await expect(t.execute({ answer: "ok" })).rejects.toThrow()
  })

  it("throws on score out of range", async () => {
    const t = structuredOutputTool("final", Schema)
    await expect(
      t.execute({ answer: "ok", score: 1.5 }),
    ).rejects.toThrow()
  })

  it("exposes zodSchema on the tool", () => {
    const t = structuredOutputTool("final", Schema)
    expect(t.zodSchema).toBe(Schema)
  })

  it("uses default description unless provided", () => {
    const t = structuredOutputTool("final", Schema)
    expect(t.description).toBe("Return final structured response")
    const t2 = structuredOutputTool("review", Schema, "Plan review output")
    expect(t2.description).toBe("Plan review output")
  })

  it("isStructuredOutputCall matches expected name", () => {
    expect(isStructuredOutputCall("planReview", "planReview")).toBe(true)
    expect(isStructuredOutputCall("other", "planReview")).toBe(false)
  })

  it("tool name validates against tool name regex", () => {
    const t = structuredOutputTool("my_tool-1", Schema)
    expect(t.name).toBe("my_tool-1")
  })
})