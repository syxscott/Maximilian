import { describe, it, expect } from "vitest"
import {
  compactMessages,
  isOverflow,
  usableTokens,
  TOOL_OUTPUT_MAX_CHARS,
  PRUNE_MINIMUM,
  DEFAULT_TAIL_TURNS,
  type CompactionConfig,
} from "../src/compaction.js"
import type { Message } from "@max/llm"

const mk = (role: Message["role"], content: string): Message =>
  ({ role, content } as Message)

const cfg: CompactionConfig = {
  contextWindow: 100_000,
  reservedOutput: 4_000,
}

describe("Context Compaction (借鉴 opencode)", () => {
  it("usableTokens = contextWindow - reservedOutput", () => {
    expect(usableTokens(cfg)).toBe(96_000)
  })

  it("isOverflow triggers at >= usable", () => {
    expect(isOverflow({ input: 96_000, output: 0 } as any, cfg)).toBe(true)
    expect(isOverflow({ input: 95_999, output: 0 } as any, cfg)).toBe(false)
  })

  it("isOverflow sums cacheRead and cacheWrite", () => {
    expect(
      isOverflow(
        { input: 50_000, output: 10_000, cacheRead: 30_000, cacheWrite: 6_000 } as any,
        cfg,
      ),
    ).toBe(true)
  })

  it("compactMessages keeps tail + adds summary header when over budget", () => {
    const msgs: Message[] = [
      mk("user", "q1"),
      mk("assistant", "a1"),
      mk("user", "q2"),
      mk("assistant", "a2"),
      mk("user", "q3"),
      mk("assistant", "a3"),
    ]
    const out = compactMessages(msgs, { ...cfg, preserveRecentTokens: 30 }, () => 10)
    expect(out[0]!.role).toBe("system")
    const headText = JSON.stringify(out[0]!.content)
    expect(headText).toContain("Compaction")
    expect(out.length).toBeLessThan(msgs.length + 1)
  })

  it("compactMessages passes through unchanged when within budget", () => {
    const msgs: Message[] = [mk("user", "q1"), mk("assistant", "a1")]
    const out = compactMessages(msgs, cfg, () => 100)
    expect(out).toEqual(msgs)
  })

  it("truncates tool output exceeding TOOL_OUTPUT_MAX_CHARS", () => {
    const big = "x".repeat(TOOL_OUTPUT_MAX_CHARS + 100)
    const out = compactMessages(
      [mk("user", "q"), mk("tool", big), mk("assistant", "a")],
      cfg,
      () => 100,
    )
    const toolMsg = out.find((m) => m.role === "tool")!
    const toolText = JSON.stringify(toolMsg.content)
    expect(toolText.length).toBeLessThanOrEqual(TOOL_OUTPUT_MAX_CHARS + 200)
    expect(toolText).toContain("Compaction")
  })

  it("small tool output passes through unchanged", () => {
    const small = "ok"
    const out = compactMessages(
      [mk("user", "q"), mk("tool", small), mk("assistant", "a")],
      cfg,
      () => 50,
    )
    const toolMsg = out.find((m) => m.role === "tool")!
    expect(toolMsg.content).toBe(small)
  })

  it("non-string tool content is JSON-stringified then truncated", () => {
    const out = compactMessages(
      [mk("user", "q"), mk("tool", { big: "x".repeat(TOOL_OUTPUT_MAX_CHARS + 50) } as any), mk("assistant", "a")],
      cfg,
      () => 50,
    )
    const toolMsg = out.find((m) => m.role === "tool")!
    expect((toolMsg.content as string).length).toBeLessThanOrEqual(
      TOOL_OUTPUT_MAX_CHARS + 100,
    )
  })

  it("preserves at least DEFAULT_TAIL_TURNS even when over budget", () => {
    const msgs: Message[] = Array.from({ length: 20 }, (_, i) =>
      mk(i % 2 === 0 ? "user" : "assistant", `m${i}-${"x".repeat(100)}`),
    )
    const out = compactMessages(msgs, { ...cfg, preserveRecentTokens: 30 }, () => 100)
    // 至少保留 DEFAULT_TAIL_TURNS 条最近
    expect(out.length).toBeGreaterThanOrEqual(DEFAULT_TAIL_TURNS + 1) // +1 summary
  })

  it("constants match opencode defaults", () => {
    expect(PRUNE_MINIMUM).toBe(20_000)
    expect(TOOL_OUTPUT_MAX_CHARS).toBe(2_000)
  })
})