// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Anthropic streaming usage collection (mainline self-audit finding).
 *
 * Contract under test: the streaming path must accumulate usage from BOTH
 * wire events — message_start carries the complete input-side usage,
 * message_delta carries the CUMULATIVE output_tokens — and attach the
 * merged, gated breakdown to the streamed chunks and the terminal chunk
 * (aligned with formats/openai-chat.ts). Dropping either event left the
 * streaming path's token accounting at zero.
 */
import { describe, expect, it } from "vitest"
import { AnthropicMessagesProvider } from "../src/formats/anthropic.js"

/** Swap the private SDK client for a scripted fake (readonly is compile-time). */
function injectClient(provider: object, client: unknown): void {
  ;(provider as unknown as { client: unknown }).client = client
}

const anthropicProvider = (client: unknown) => {
  const p = new AnthropicMessagesProvider({
    id: "t",
    name: "t",
    apiKey: "k",
    defaultModel: "claude-x",
  })
  injectClient(p, client)
  return p
}

async function* fakeAnthropicStream(events: unknown[]) {
  for (const event of events) yield event
}

class FakeAnthropicStreamClient {
  messages: { create: (opts: Record<string, unknown>) => Promise<AsyncIterable<unknown>> }
  constructor(events: unknown[]) {
    this.messages = {
      create: async () => fakeAnthropicStream(events),
    }
  }
}

interface CollectedChunk {
  delta: string
  done: boolean
  usage: unknown
  finishReason?: string
}

async function collect(p: AnthropicMessagesProvider): Promise<CollectedChunk[]> {
  const chunks: CollectedChunk[] = []
  for await (const chunk of p.stream([{ role: "user", content: "hi" }])) {
    chunks.push({
      delta: chunk.delta,
      done: chunk.done,
      usage: chunk.usage,
      finishReason: chunk.finishReason,
    })
  }
  return chunks
}

describe("anthropic streaming usage collection", () => {
  it("merges message_start input usage with message_delta cumulative output_tokens", async () => {
    const p = anthropicProvider(
      new FakeAnthropicStreamClient([
        {
          type: "message_start",
          message: {
            usage: {
              input_tokens: 25,
              output_tokens: 1,
              cache_read_input_tokens: 7,
              cache_creation_input_tokens: 3,
            },
          },
        },
        { type: "content_block_delta", delta: { type: "text_delta", text: "hello" } },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: { output_tokens: 42 },
        },
        { type: "content_block_delta", delta: { type: "text_delta", text: " world" } },
      ]),
    )
    const chunks = await collect(p)

    // The pre-delta chunk carries the message_start measurement.
    expect(chunks[0]).toMatchObject({
      delta: "hello",
      usage: {
        promptTokens: 25,
        completionTokens: 1,
        totalTokens: 26,
        cacheReadTokens: 7,
        cacheCreationTokens: 3,
      },
    })

    // After message_delta the cumulative output has replaced the start value.
    expect(chunks[1]).toMatchObject({
      delta: " world",
      usage: {
        promptTokens: 25,
        completionTokens: 42,
        totalTokens: 67,
        cacheReadTokens: 7,
        cacheCreationTokens: 3,
      },
    })

    // The terminal chunk carries the full merged breakdown.
    const terminal = chunks[chunks.length - 1]!
    expect(terminal.done).toBe(true)
    expect(terminal.finishReason).toBe("end_turn")
    expect(terminal.usage).toEqual({
      promptTokens: 25,
      completionTokens: 42,
      totalTokens: 67,
      cacheReadTokens: 7,
      cacheCreationTokens: 3,
      reasoningTokens: 0,
    })
  })

  it("attaches usage to the terminal chunk even without text deltas", async () => {
    const p = anthropicProvider(
      new FakeAnthropicStreamClient([
        { type: "message_start", message: { usage: { input_tokens: 9, output_tokens: 0 } } },
        {
          type: "message_delta",
          delta: { stop_reason: "max_tokens" },
          usage: { output_tokens: 4 },
        },
      ]),
    )
    const chunks = await collect(p)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]!.done).toBe(true)
    expect(chunks[0]!.usage).toEqual({
      promptTokens: 9,
      completionTokens: 4,
      totalTokens: 13,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      reasoningTokens: 0,
    })
  })

  it("yields usage UNKNOWN (undefined) when the stream carries no message_start usage", async () => {
    const p = anthropicProvider(
      new FakeAnthropicStreamClient([
        { type: "content_block_delta", delta: { type: "text_delta", text: "no usage anywhere" } },
      ]),
    )
    const chunks = await collect(p)
    expect(chunks[chunks.length - 1]!.usage).toBeUndefined()
  })

  it("drops an inconsistent breakdown instead of zero-filling it (gate seam)", async () => {
    // message_delta reports output_tokens that contradict nothing by itself,
    // but a garbage input_tokens value must NOT become fake accounting.
    const p = anthropicProvider(
      new FakeAnthropicStreamClient([
        { type: "message_start", message: { usage: { input_tokens: "garbage" } } },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 42 } },
      ]),
    )
    const chunks = await collect(p)
    expect(chunks[chunks.length - 1]!.usage).toBeUndefined()
  })
})

describe("anthropic non-streaming usage gate", () => {
  it("keeps exclusive cache semantics: cache_read may exceed fresh input", async () => {
    const p = anthropicProvider({
      messages: {
        create: async () => ({
          content: [{ type: "text", text: "ok" }],
          model: "claude-x",
          stop_reason: "end_turn",
          usage: {
            input_tokens: 100,
            output_tokens: 40,
            cache_read_input_tokens: 900,
            cache_creation_input_tokens: 50,
          },
        }),
      },
    })
    const res = await p.chat([{ role: "user", content: "hi" }])
    expect(res.usage).toEqual({
      promptTokens: 100,
      completionTokens: 40,
      totalTokens: 140,
      cacheReadTokens: 900,
      cacheCreationTokens: 50,
      reasoningTokens: 0,
    })
  })

  it("reports usage UNKNOWN when the breakdown is inconsistent", async () => {
    const p = anthropicProvider({
      messages: {
        create: async () => ({
          content: [{ type: "text", text: "ok" }],
          model: "claude-x",
          stop_reason: "end_turn",
          usage: { input_tokens: 100, output_tokens: 40, total_tokens: 999 },
        }),
      },
    })
    const res = await p.chat([{ role: "user", content: "hi" }])
    expect(res.usage).toBeUndefined()
  })
})
