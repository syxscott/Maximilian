import { describe, it, expect } from "vitest"
import {
  compactMessages,
  estimateMessagesTokens,
  forceCompactToFractionOfRequest,
  isCompactionBoundary,
  isOverflow,
  usableTokens,
  TOOL_OUTPUT_MAX_CHARS,
  PRUNE_MINIMUM,
  type CompactionConfig,
} from "../src/compaction.js"
import { endsWithLoneHighSurrogate } from "../src/text-safe.js"
import type { Message } from "@max/llm"

const mk = (role: Message["role"], content: string): Message => ({ role, content }) as Message

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
    expect(headText).toContain("compaction")
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
      [
        mk("user", "q"),
        mk("tool", { big: "x".repeat(TOOL_OUTPUT_MAX_CHARS + 50) } as any),
        mk("assistant", "a"),
      ],
      cfg,
      () => 50,
    )
    const toolMsg = out.find((m) => m.role === "tool")!
    expect((toolMsg.content as string).length).toBeLessThanOrEqual(TOOL_OUTPUT_MAX_CHARS + 100)
  })

  it("keeps the retained tail within preserveRecent (+1 per message separator)", () => {
    // Each message estimates 20 tokens; the newest (20+1) fits the 30-token
    // budget, adding the second-newest would total 42 > 30. Only the newest
    // may survive, and the joined tail stays within the budget.
    const msgs: Message[] = [mk("user", "old-0"), mk("assistant", "old-1"), mk("user", "newest")]
    const budget = 30
    const out = compactMessages(msgs, { ...cfg, preserveRecentTokens: budget }, () => 20)
    expect(out[0]!.role).toBe("system")
    const kept = out.slice(1)
    expect(kept).toEqual([mk("user", "newest")])
    const withSeparators = estimateMessagesTokens(kept, () => 20) + kept.length
    expect(withSeparators).toBeLessThanOrEqual(budget)
  })

  it("force-compact writes a tail that does not overflow the target a second time", () => {
    const messages: Message[] = Array.from({ length: 8 }, (_, i) =>
      mk(i % 2 === 0 ? "user" : "assistant", `m${i}`),
    )
    const estimate = (): number => 100
    const rejected = estimateMessagesTokens(messages, estimate) // 800
    const target = Math.floor(rejected * 0.5) // 400
    const out = forceCompactToFractionOfRequest(messages, cfg, estimate, 0.5)
    expect(isCompactionBoundary(out[0]!)).toBe(true)
    const kept = out.slice(1)
    // 100+1 per message: 101, 202, 303 fit; a fourth would reach 404 > 400.
    expect(estimateMessagesTokens(kept, estimate) + kept.length).toBeLessThanOrEqual(target)
  })

  it("truncates tool output without splitting a surrogate pair", () => {
    // "ab😀cd": budget 3 lands between the two halves of U+1F600, so the
    // high half must be dropped instead of emitted alone.
    const text = "ab😀cd"
    const out = compactMessages(
      [mk("user", "q"), mk("tool", text), mk("assistant", "a")],
      { ...cfg, maxToolOutputChars: 3 },
      () => 1,
    )
    const toolMsg = out.find((m) => m.role === "tool")!
    const part = (toolMsg.content as Array<{ type: string; text: string }>)[0]!
    expect(part.text.startsWith("ab")).toBe(true)
    expect(part.text).not.toContain("\uD83D")
    expect(endsWithLoneHighSurrogate(part.text)).toBe(false)
  })

  it("constants match opencode defaults", () => {
    expect(PRUNE_MINIMUM).toBe(20_000)
    expect(TOOL_OUTPUT_MAX_CHARS).toBe(2_000)
  })
})
