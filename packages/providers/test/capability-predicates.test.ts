// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Capability predicates + client-side stop-word fallback (crewAI 107fab8c8
 * supports_stop_words borrowing). Test contract pinned by the upstream fix:
 * for a model family that rejects stop sequences, the wire parameter is NOT
 * sent AND the result is still truncated client-side.
 */
import { describe, expect, it } from "vitest"
import {
  supportsStopSequences,
  wireStopSequences,
  applyStopWordsClientSide,
  applyStopWordsToChunkStream,
  withClientSideStopSequences,
} from "../src/capability-predicates.js"
import type { ChatChunk, ChatMessage, Provider } from "../src/base.js"

const collect = async (chunks: AsyncIterable<ChatChunk>): Promise<ChatChunk[]> => {
  const out: ChatChunk[] = []
  for await (const chunk of chunks) out.push(chunk)
  return out
}

describe("supportsStopSequences — model-id pattern table", () => {
  it("rejects Bedrock's OpenAI-hosted family (the crewAI 400 case)", () => {
    expect(supportsStopSequences("openai.gpt-oss-120b-1:0")).toBe(false)
    expect(supportsStopSequences("us.openai.gpt-6-sol")).toBe(false)
    expect(supportsStopSequences("global.openai.gpt-6-luna")).toBe(false)
  })

  it("does NOT reject plain OpenAI or other ids (unknown → accepted)", () => {
    expect(supportsStopSequences("openai/gpt-5.6")).toBe(true)
    expect(supportsStopSequences("gpt-5.6")).toBe(true)
    expect(supportsStopSequences("claude-sonnet-4-5")).toBe(true)
    expect(supportsStopSequences("deepseek-chat")).toBe(true)
    expect(supportsStopSequences(undefined)).toBe(true)
  })
})

describe("wireStopSequences — the wire gate", () => {
  it("omits the parameter entirely for a rejecting family", () => {
    expect(wireStopSequences("openai.gpt-oss-120b-1:0", ["\nObservation:"])).toBeUndefined()
  })

  it("passes stop sequences through for accepting models", () => {
    expect(wireStopSequences("claude-sonnet-4-5", ["\nObservation:"])).toEqual(["\nObservation:"])
  })

  it("returns undefined when nothing was requested", () => {
    expect(wireStopSequences("claude-sonnet-4-5", undefined)).toBeUndefined()
    expect(wireStopSequences("claude-sonnet-4-5", [])).toBeUndefined()
  })
})

describe("applyStopWordsClientSide — the semantic fallback", () => {
  it("truncates at the earliest stop sequence occurrence", () => {
    expect(applyStopWordsClientSide("Thought: done\nObservation: extra", ["\nObservation:"])).toBe(
      "Thought: done",
    )
  })

  it("picks the earliest of several stop sequences", () => {
    expect(
      applyStopWordsClientSide("a\nThought:x\nObservation:y", ["\nObservation:", "\nThought:"]),
    ).toBe("a")
  })

  it("leaves text without any stop sequence untouched", () => {
    expect(applyStopWordsClientSide("clean output", ["\nObservation:"])).toBe("clean output")
  })

  it("is idempotent for providers that already honored the wire parameter", () => {
    const once = applyStopWordsClientSide("done\nObservation:", ["\nObservation:"])
    expect(applyStopWordsClientSide(once, ["\nObservation:"])).toBe(once)
  })

  it("ignores empty stop sequences", () => {
    expect(applyStopWordsClientSide("kept", [""])).toBe("kept")
  })
})

describe("applyStopWordsToChunkStream — deltas that straddle chunks", () => {
  const chunks = (...deltas: string[]): AsyncIterable<ChatChunk> =>
    (async function* () {
      for (const delta of deltas) yield { delta, done: false }
      yield { delta: "", done: true, finishReason: "stop" }
    })()

  it("suppresses the tail once a stop sequence completes across a chunk boundary", async () => {
    const out = await collect(
      applyStopWordsToChunkStream(chunks("Thought: do", "ne\nObserv", "ation: junk"), [
        "\nObservation:",
      ]),
    )
    expect(out.map((c) => c.delta).join("")).toBe("Thought: done")
    // The truncating chunk terminates the stream.
    expect(out[out.length - 1]!.done).toBe(true)
  })

  it("holds back a partial stop-sequence prefix but releases it when the match dissolves", async () => {
    const out = await collect(
      applyStopWordsToChunkStream(chunks("abc", "def\nObservation: x"), ["\nObservation:"]),
    )
    expect(out.map((c) => c.delta).join("")).toBe("abcdef")
  })

  it("passes untouched streams through with their terminal chunk", async () => {
    const out = await collect(
      applyStopWordsToChunkStream(chunks("hello ", "world"), ["\nObservation:"]),
    )
    expect(out.map((c) => c.delta).join("")).toBe("hello world")
    expect(out[out.length - 1]!.done).toBe(true)
    expect(out[out.length - 1]!.finishReason).toBe("stop")
  })

  it("a stream with no stop sequences requested is a pure passthrough", async () => {
    const out = await collect(applyStopWordsToChunkStream(chunks("a", "b"), undefined))
    expect(out.map((c) => c.delta).join("")).toBe("ab")
  })
})

describe("withClientSideStopSequences — provider decorator (不发参数但结果仍截断)", () => {
  const STOP = ["\nObservation:"]

  /** Provider whose model family rejects stopSequences — the format layer's
   * wire gate already stripped the parameter, so the provider never sees it
   * and the model ignores the stop semantics entirely. */
  const rejectingModelProvider = (wireOutput: string): Provider => ({
    id: "bedrock",
    name: "bedrock",
    defaultModel: "openai.gpt-oss-120b-1:0",
    isConfigured: () => true,
    async chat(_messages, options) {
      return {
        content: wireOutput,
        model: options?.model ?? "openai.gpt-oss-120b-1:0",
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      }
    },
    async *stream(_messages, _options) {
      yield { delta: wireOutput, done: false }
      yield { delta: "", done: true, finishReason: "stop" }
    },
  })

  it("chat: the model ignores stop words, yet the answer is still truncated", async () => {
    const wrapped = withClientSideStopSequences(
      rejectingModelProvider("Thought: done\nObservation: leaked tail"),
    )
    const response = await wrapped.chat([{ role: "user", content: "go" }], {
      model: "openai.gpt-oss-120b-1:0",
      stopSequences: STOP,
    })
    expect(response.content).toBe("Thought: done")
  })

  it("stream: deltas are truncated the same way", async () => {
    const wrapped = withClientSideStopSequences(rejectingModelProvider("done\nObservation: leaked"))
    const out = await collect(
      wrapped.stream([{ role: "user", content: "go" }], { stopSequences: STOP }),
    )
    expect(out.map((c) => c.delta).join("")).toBe("done")
  })

  it("accepting models behave identically (idempotent double truncation)", async () => {
    const wrapped = withClientSideStopSequences(rejectingModelProvider("done\nObservation: x"))
    const response = await wrapped.chat([{ role: "user", content: "go" }], {
      model: "claude-sonnet-4-5",
      stopSequences: STOP,
    })
    expect(response.content).toBe("done")
  })

  it("without stop sequences the decorator is a transparent passthrough", async () => {
    const wrapped = withClientSideStopSequences(rejectingModelProvider("raw"))
    const response = await wrapped.chat([{ role: "user", content: "go" }], {})
    expect(response.content).toBe("raw")
  })
})
