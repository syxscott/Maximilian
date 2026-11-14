// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Proactive dual-signal compaction + per-turn LLM summary tests (borrowing;
 * Mini-Agent mini_agent/agent.py:201-319).
 *
 * Verifies:
 *   - the loop compacts BEFORE a send when EITHER the injected local
 *     estimate OR the last API-reported usage exceeds the limit (dual
 *     signal), exactly once, and one-shot-debounces the NEXT check while
 *     the reported total is still stale;
 *   - per-turn summaries keep the system head and EVERY real user
 *     message, summarize each user→user execution segment separately;
 *   - a failing/empty summarizer degrades the segment to its raw
 *     concatenated text (usable, nothing lost);
 *   - without an injected summarizer the existing truncation compaction
 *     applies (compactMessages semantics).
 */
import { describe, expect, it } from "vitest"
import { makeTool } from "@max/llm"
import {
  COMPACTION_SUMMARY_MARKER,
  TURN_SUMMARY_MARKER,
  compactProactiveHistory,
  summarizePerTurn,
} from "../src/compaction.js"
import { defaultContextOverflowRecovery, defaultProactiveCompaction } from "../src/runtime.js"
import { ToolEnabledProvider, createToolRegistry, runToolLoop } from "../src/tool-integration.js"
import type { ChatMessage, ChatOptions, ChatResponse, Provider } from "@max/providers"

// ── Harness (mirrors tool-loop-overflow-recovery.test.ts) ──────────────────

class ScriptedProvider implements Provider {
  id = "scripted"
  name = "scripted"
  defaultModel = "scripted-1"
  isConfigured(): boolean {
    return true
  }
  /** Chat call log: every request the pipeline actually sent. */
  readonly requests: ChatMessage[][] = []
  private step = 0
  constructor(private readonly script: Array<(messages: ChatMessage[]) => Promise<ChatResponse>>) {}
  async chat(messages: ChatMessage[], _options?: ChatOptions): Promise<ChatResponse> {
    this.requests.push(messages.map((m) => ({ ...m })))
    const handler = this.script[Math.min(this.step, this.script.length - 1)]!
    this.step++
    return handler(messages)
  }
  async *stream(): AsyncIterable<never> {
    throw new Error("not used")
  }
}

const plainWithUsage = (content: string, totalTokens: number): ChatResponse => ({
  content,
  model: "scripted-1",
  usage: { promptTokens: totalTokens - 1, completionTokens: 1, totalTokens },
})

const toolCallWithUsage = (name: string, totalTokens: number): ChatResponse => ({
  content: "```tool\n" + JSON.stringify({ name, input: { x: 1 } }) + "\n```\nworking",
  model: "scripted-1",
  usage: { promptTokens: totalTokens - 1, completionTokens: 1, totalTokens },
})

function makeLoop(provider: Provider): ToolEnabledProvider {
  const registry = createToolRegistry()
  registry.register({
    echo: makeTool({
      name: "echo",
      description: "echo the input back",
      kind: "misc",
      inputSchema: { type: "object" },
      execute: async (input) => input,
    }),
  })
  return new ToolEnabledProvider(provider, registry)
}

// ── summarizePerTurn (unit) ────────────────────────────────────────────────

describe("summarizePerTurn (borrowing; Mini-Agent _summarize_messages)", () => {
  it("keeps the system head and EVERY real user message, summarizes each segment", async () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "you are an agent" },
      { role: "user", content: "first intent" },
      { role: "assistant", content: "working on it" },
      { role: "user", content: '[Tool Result: echo]\n{"x":1}' },
      { role: "user", content: "second intent" },
      { role: "assistant", content: "still going" },
    ]
    const rounds: Array<{ round: number; text: string }> = []
    const {
      messages: out,
      summarizedTurns,
      degradedTurns,
    } = await summarizePerTurn(messages, async (r) => {
      rounds.push(r)
      return `summary ${r.round}`
    })

    // Structure: system + user1 + summary + user2 + summary.
    expect(out.map((m) => m.role)).toEqual(["system", "user", "user", "user", "user"])
    expect(out[1]!.content).toBe("first intent")
    expect(out[3]!.content).toBe("second intent")
    // Tool-result user messages are segment content (summarized away).
    expect(out[2]!.content).toBe(`${TURN_SUMMARY_MARKER}\n\nsummary 1`)
    expect(out[4]!.content).toBe(`${TURN_SUMMARY_MARKER}\n\nsummary 2`)
    expect(summarizedTurns).toBe(2)
    expect(degradedTurns).toBe(0)
    // Each segment's flat text separates assistant lines from tool lines.
    expect(rounds[0]).toEqual({
      round: 1,
      text: 'Assistant: working on it\nTool returned: [Tool Result: echo]\n{"x":1}',
    })
  })

  it("a failing summarizer degrades the segment to its raw concatenated text", async () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "intent" },
      { role: "assistant", content: "did the work" },
      { role: "user", content: '[Tool Result: bash]\n{"ok":true}' },
    ]
    const {
      messages: out,
      summarizedTurns,
      degradedTurns,
    } = await summarizePerTurn(messages, async () => {
      throw new Error("summarizer down")
    })
    expect(summarizedTurns).toBe(0)
    expect(degradedTurns).toBe(1)
    // The degraded summary carries the RAW execution text — usable.
    expect(out[0]!.content).toBe("intent")
    const degraded = out[1]!.content
    expect(degraded).toContain(`${TURN_SUMMARY_MARKER} (degraded)`)
    expect(degraded).toContain("Assistant: did the work")
    expect(degraded).toContain("Tool returned: [Tool Result: bash]")
  })

  it("an empty summarizer verdict also degrades (nothing silently dropped)", async () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "intent" },
      { role: "assistant", content: "evidence" },
    ]
    const { messages: out, degradedTurns } = await summarizePerTurn(messages, async () => "")
    expect(degradedTurns).toBe(1)
    expect(out[1]!.content).toContain("Assistant: evidence")
  })

  it("without user messages the history is returned unchanged", async () => {
    const messages: ChatMessage[] = [{ role: "assistant", content: "orphan" }]
    const { messages: out, summarizedTurns, degradedTurns } = await summarizePerTurn(messages)
    expect(out).toEqual(messages)
    expect(summarizedTurns).toBe(0)
    expect(degradedTurns).toBe(0)
  })
})

describe("compactProactiveHistory (borrowing; summarizer optional)", () => {
  it("without a summarizer it uses the existing truncation compaction", async () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "old intent" },
      { role: "assistant", content: "old work" },
      { role: "user", content: "recent intent" },
      { role: "assistant", content: "recent work" },
    ]
    const out = await compactProactiveHistory(messages, {
      tokenLimit: 20,
      // 1000 tokens per message: the preserve budget floors at 2000, so
      // only the last two messages survive and the early ones are dropped
      // behind the existing truncation boundary.
      estimateTokens: (ms) => ms.length * 1000,
    })
    // Truncation marks the boundary instead of per-turn summaries.
    expect(out.some((m) => m.content.includes(COMPACTION_SUMMARY_MARKER))).toBe(true)
    expect(out.some((m) => m.content.includes(TURN_SUMMARY_MARKER))).toBe(false)
    expect(out.some((m) => m.content === "recent intent")).toBe(true)
  })
})

// ── Loop integration: dual signal + one-shot debounce ──────────────────────

describe("runToolLoop proactive dual-signal compaction (borrowing)", () => {
  it("an over-limit API usage triggers ONE compaction and the next check is debounced", async () => {
    const summarizerCalls: Array<{ round: number; text: string }> = []
    const provider = new ScriptedProvider([
      // Round 0: over-limit usage reported WITH a tool call.
      async () => toolCallWithUsage("echo", 500),
      // Round 1: still stale-over usage; the debounce must prevent a
      // second compaction BEFORE this send.
      async () => toolCallWithUsage("echo", 500),
      // Round 2: fresh, under-limit usage — clean exit.
      async () => plainWithUsage("done", 10),
    ])
    const localEstimate = 10 // under limit — the API signal must be the trigger

    const { response, proactiveCompactions } = await runToolLoop(
      makeLoop(provider),
      [
        { role: "user", content: "first intent" },
        { role: "user", content: "second intent" },
      ],
      {
        proactiveCompaction: {
          tokenLimit: 50,
          estimateTokens: () => localEstimate,
          summarizer: async (r) => {
            summarizerCalls.push(r)
            return `summary ${r.round}`
          },
        },
      },
    )

    expect(response.content).toBe("done")
    expect(proactiveCompactions).toBe(1)
    expect(summarizerCalls).toHaveLength(1)

    // Round 1's send carried the compacted history: real user intents
    // preserved, the first segment replaced by its summary.
    const compactedRequest = provider.requests[1]!
    expect(compactedRequest.some((m) => m.content === "first intent")).toBe(true)
    expect(compactedRequest.some((m) => m.content === "second intent")).toBe(true)
    expect(compactedRequest.some((m) => m.content.startsWith(TURN_SUMMARY_MARKER))).toBe(true)
    expect(compactedRequest.some((m) => m.content === "working")).toBe(false)
    // Round 2's send (after the debounce) has NO second summary and still
    // carries the user intents.
    const thirdRequest = provider.requests[2]!
    expect(thirdRequest.filter((m) => m.content.startsWith(TURN_SUMMARY_MARKER))).toHaveLength(1)
    expect(thirdRequest.some((m) => m.content === "second intent")).toBe(true)
  })

  it("an over-limit LOCAL estimate triggers the compaction when no usage exists yet", async () => {
    const summarizerCalls: Array<{ round: number }> = []
    const provider = new ScriptedProvider([
      // Round 0: no tool call — but the pre-send estimate was over the
      // limit, so the request must have gone out compacted already.
      async () => plainWithUsage("done", 10),
    ])
    const { proactiveCompactions } = await runToolLoop(
      makeLoop(provider),
      [
        { role: "user", content: "intent one" },
        { role: "user", content: "intent two" },
        // Prior execution content — the last segment's summary source.
        { role: "assistant", content: "prior work" },
      ],
      {
        proactiveCompaction: {
          tokenLimit: 10,
          // ~100 tokens per message — way over the 10-token limit.
          estimateTokens: (ms) => ms.length * 100,
          summarizer: async (r) => {
            summarizerCalls.push(r)
            return `summary ${r.round}`
          },
        },
      },
    )
    expect(proactiveCompactions).toBe(1)
    expect(summarizerCalls).toHaveLength(1)
    // The FIRST physical request already carried the compacted history:
    // user intents preserved, the execution segment summarized.
    expect(provider.requests[0]!.some((m) => m.content === "intent one")).toBe(true)
    expect(provider.requests[0]!.some((m) => m.content === "intent two")).toBe(true)
    expect(provider.requests[0]!.some((m) => m.content.startsWith(TURN_SUMMARY_MARKER))).toBe(true)
    expect(provider.requests[0]!.some((m) => m.content === "prior work")).toBe(false)
  })

  it("without proactiveCompaction the loop behaves exactly as before (passive only)", async () => {
    const provider = new ScriptedProvider([async () => plainWithUsage("done", 5000)])
    const { response, proactiveCompactions } = await runToolLoop(
      makeLoop(provider),
      [{ role: "user", content: "intent" }],
      {},
    )
    expect(response.content).toBe("done")
    expect(proactiveCompactions).toBe(0)
    // The oversized usage was never acted on.
    expect(provider.requests[0]!).toHaveLength(1)
  })
})

// ── main-session wiring seam: forceFraction + runtime defaults ──────────────

describe("compactProactiveHistory forceFraction (overflow recovery wiring)", () => {
  it("compacts to a fraction of the rejected request, preserving real user intents", async () => {
    const big = (text: string): ChatMessage => ({ role: "assistant", content: text })
    const rejected: ChatMessage[] = [
      { role: "user", content: "real intent one" },
      big("x".repeat(40_000)),
      { role: "user", content: "[Tool Result: bash]\n" + "y".repeat(40_000) },
      big("z".repeat(40_000)),
      { role: "user", content: "real intent two" },
    ]
    const estimate = (msgs: readonly ChatMessage[]) =>
      msgs.reduce((s, m) => s + Math.ceil(m.content.length / 4), 0)
    const out = await compactProactiveHistory(rejected, {
      tokenLimit: 120_000,
      estimateTokens: estimate,
      forceFraction: 0.5,
    })
    const before = estimate(rejected)
    const after = estimate(out)
    // The bulk is compacted toward the fraction; the floor is the
    // DEFAULT_TAIL_TURNS=2 verbatim tail plus kept messages, so the honest
    // guarantee is meaningful shrinkage, not exact halving.
    expect(after).toBeLessThan(before * 0.75)
    // Real user intents survive verbatim; tool-result user messages are
    // segment content and may be summarized away.
    const texts = out.map((m) => m.content)
    expect(texts).toContain("real intent one")
    expect(texts).toContain("real intent two")
    expect(out.some((m) => m.content.includes(COMPACTION_SUMMARY_MARKER))).toBe(true)
  })
})

describe("runtime overflow-recovery wiring defaults", () => {
  it("defaultProactiveCompaction fires past the ceiling with a chars/4 estimate", () => {
    const cfg = defaultProactiveCompaction()
    expect(cfg.tokenLimit).toBe(120_000)
    const small: ChatMessage[] = [{ role: "user", content: "hello" }]
    expect(cfg.estimateTokens(small)).toBeLessThan(cfg.tokenLimit)
    const runaway: ChatMessage[] = Array.from({ length: 400 }, () => ({
      role: "assistant" as const,
      content: "x".repeat(4_000),
    }))
    expect(cfg.estimateTokens(runaway)).toBeGreaterThan(cfg.tokenLimit)
  })

  it("defaultContextOverflowRecovery shrinks an oversized request once", async () => {
    const recover = defaultContextOverflowRecovery()
    const rejected: ChatMessage[] = Array.from({ length: 50 }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: i % 2 === 0 ? `intent ${i}` : "y".repeat(20_000),
    }))
    const out = await recover(rejected)
    expect(out).toBeDefined()
    expect(out!.length).toBeLessThan(rejected.length)
    expect(out!.some((m) => m.content === "intent 0")).toBe(true)
  })
})
