// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Refusal finishReason mapping across the three provider formats (deepseek
 * chat-demo reply.ts settleReply borrowing): a safety refusal must reach
 * `finishReason: "refusal"` on BOTH paths of every format —
 *   - anthropic: stop_reason passthrough (non-streaming `response.stop_reason`,
 *     streaming `message_delta.delta.stop_reason`)
 *   - openai_chat: non-empty assistant `refusal` field (finish_reason stays
 *     "stop") — non-streaming and streamed `delta.refusal`
 *   - openai_responses: output refusal parts / `response.refusal.*` events
 *
 * Other finishReason semantics must remain untouched.
 */
import { describe, expect, it } from "vitest"
import { AnthropicMessagesProvider } from "../src/formats/anthropic.js"
import { OpenAIChatProvider } from "../src/formats/openai-chat.js"
import { OpenAIResponsesProvider } from "../src/formats/openai-responses.js"

/** Swap the private SDK client for a scripted fake (readonly is compile-time). */
function injectClient(provider: object, client: unknown): void {
  ;(provider as unknown as { client: unknown }).client = client
}

const anthropicMessage = (stopReason: string | null) => ({
  content: [{ type: "text", text: "partial answer" }],
  model: "claude-x",
  stop_reason: stopReason,
  usage: { input_tokens: 3, output_tokens: 5 },
})

class FakeAnthropic {
  messages: { create: (opts: Record<string, unknown>) => Promise<unknown> }
  constructor(response: unknown) {
    this.messages = {
      create: async () => response,
    }
  }
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

describe("anthropic refusal mapping", () => {
  it("non-streaming stop_reason 'refusal' reaches finishReason", async () => {
    const p = anthropicProvider(new FakeAnthropic(anthropicMessage("refusal")))
    const res = await p.chat([{ role: "user", content: "hi" }])
    expect(res.finishReason).toBe("refusal")
    // The partial body is untouched at the provider layer — settlement
    // happens in the core loop.
    expect(res.content).toBe("partial answer")
  })

  it("non-streaming other stop reasons pass through unchanged", async () => {
    const p = anthropicProvider(new FakeAnthropic(anthropicMessage("end_turn")))
    const res = await p.chat([{ role: "user", content: "hi" }])
    expect(res.finishReason).toBe("end_turn")
  })

  it("streaming message_delta stop_reason 'refusal' reaches the terminal chunk", async () => {
    const p = anthropicProvider(
      new FakeAnthropicStreamClient([
        { type: "message_start", message: { usage: { input_tokens: 1 } } },
        { type: "content_block_delta", delta: { type: "text_delta", text: "I cannot" } },
        { type: "message_delta", delta: { stop_reason: "refusal", stop_sequence: null } },
      ]),
    )
    const chunks = []
    for await (const chunk of p.stream([{ role: "user", content: "hi" }])) chunks.push(chunk)
    const last = chunks[chunks.length - 1]!
    expect(last.done).toBe(true)
    expect(last.finishReason).toBe("refusal")
  })

  it("streaming non-refusal stop_reason still lands on the terminal chunk", async () => {
    const p = anthropicProvider(
      new FakeAnthropicStreamClient([
        { type: "content_block_delta", delta: { type: "text_delta", text: "hello" } },
        { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null } },
      ]),
    )
    const chunks = []
    for await (const chunk of p.stream([{ role: "user", content: "hi" }])) chunks.push(chunk)
    expect(chunks[chunks.length - 1]!.finishReason).toBe("end_turn")
  })
})

// ── openai_chat ──────────────────────────────────────────────────────────────

const openaiCompletion = (message: unknown, finishReason: string | null) => ({
  model: "gpt-x",
  choices: [{ message, finish_reason: finishReason }],
  usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
})

class FakeOpenAIChat {
  chat: { completions: { create: (opts: Record<string, unknown>) => Promise<unknown> } }
  responses: Record<string, never>
  constructor(response: unknown) {
    this.chat = { completions: { create: async () => response } }
    this.responses = {}
  }
}

class FakeOpenAIChatStream {
  chat: {
    completions: { create: (opts: Record<string, unknown>) => Promise<AsyncIterable<unknown>> }
  }
  responses: Record<string, never>
  constructor(private events: unknown[]) {
    this.chat = { completions: { create: async () => this.iterate() } }
    this.responses = {}
  }
  async *iterate(): AsyncIterable<unknown> {
    for (const event of this.events) yield event
  }
}

const openaiChatProvider = (client: unknown) => {
  const p = new OpenAIChatProvider({
    id: "t",
    name: "t",
    apiKey: "k",
    baseURL: "https://example.com/v1",
    defaultModel: "gpt-x",
  })
  injectClient(p, client)
  return p
}

describe("openai_chat refusal mapping", () => {
  it("non-streaming: non-empty message.refusal maps to finishReason 'refusal'", async () => {
    const p = openaiChatProvider(
      new FakeOpenAIChat(
        openaiCompletion({ content: null, refusal: "I can't help with that" }, "stop"),
      ),
    )
    const res = await p.chat([{ role: "user", content: "hi" }])
    expect(res.finishReason).toBe("refusal")
  })

  it("non-streaming: null refusal keeps finish_reason passthrough", async () => {
    const p = openaiChatProvider(
      new FakeOpenAIChat(openaiCompletion({ content: "ok", refusal: null }, "stop")),
    )
    const res = await p.chat([{ role: "user", content: "hi" }])
    expect(res.finishReason).toBe("stop")
  })

  it("non-streaming: empty-string refusal does not trigger the mapping", async () => {
    const p = openaiChatProvider(
      new FakeOpenAIChat(openaiCompletion({ content: "ok", refusal: "" }, "length")),
    )
    const res = await p.chat([{ role: "user", content: "hi" }])
    expect(res.finishReason).toBe("length")
  })

  it("streaming: delta.refusal flips the finishReason to 'refusal'", async () => {
    const p = openaiChatProvider(
      new FakeOpenAIChatStream([
        { choices: [{ delta: { refusal: "I can't help" }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ]),
    )
    const chunks = []
    for await (const chunk of p.stream([{ role: "user", content: "hi" }])) chunks.push(chunk)
    expect(chunks[chunks.length - 1]!.done).toBe(true)
    expect(chunks[chunks.length - 1]!.finishReason).toBe("refusal")
  })
})

// ── openai_responses ─────────────────────────────────────────────────────────

const openaiResponsesProvider = (client: unknown) => {
  const p = new OpenAIResponsesProvider({
    id: "t",
    name: "t",
    apiKey: "k",
    baseURL: "https://example.com/v1",
    defaultModel: "gpt-x",
  })
  injectClient(p, client)
  return p
}

class FakeOpenAIResponses {
  responses: { create: (opts: Record<string, unknown>) => Promise<unknown> }
  constructor(response: unknown) {
    this.responses = { create: async () => response }
  }
}

class FakeOpenAIResponsesStream {
  responses: { create: (opts: Record<string, unknown>) => Promise<AsyncIterable<unknown>> }
  constructor(private readonly events: unknown[]) {
    const self = this
    this.responses = {
      create: async () => self.iterate(),
    }
  }
  async *iterate(): AsyncIterable<unknown> {
    for (const event of this.events) yield event
  }
}

describe("openai_responses refusal mapping", () => {
  it("non-streaming: refusal content part maps to finishReason 'refusal'", async () => {
    const p = openaiResponsesProvider(
      new FakeOpenAIResponses({
        model: "gpt-x",
        output: [
          {
            type: "message",
            content: [{ type: "refusal", refusal: "Sorry, I can't with that request" }],
          },
        ],
        usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
      }),
    )
    const res = await p.chat([{ role: "user", content: "hi" }])
    expect(res.finishReason).toBe("refusal")
  })

  it("non-streaming: refusal-typed output item maps to finishReason 'refusal'", async () => {
    const p = openaiResponsesProvider(
      new FakeOpenAIResponses({
        model: "gpt-x",
        output: [{ type: "refusal" }],
      }),
    )
    const res = await p.chat([{ role: "user", content: "hi" }])
    expect(res.finishReason).toBe("refusal")
  })

  it("non-streaming: plain output keeps finishReason undefined (no semantic change)", async () => {
    const p = openaiResponsesProvider(
      new FakeOpenAIResponses({
        model: "gpt-x",
        output: [{ type: "message", content: [{ type: "output_text", text: "hello" }] }],
      }),
    )
    const res = await p.chat([{ role: "user", content: "hi" }])
    expect(res.finishReason).toBeUndefined()
    expect(res.content).toBe("hello")
  })

  it("streaming: response.refusal.* events mark the terminal chunk refused", async () => {
    const p = openaiResponsesProvider(
      new FakeOpenAIResponsesStream([
        { type: "response.output_text.delta", delta: "I " },
        { type: "response.refusal.delta", delta: "can't help" },
        { type: "response.completed" },
      ]),
    )
    const chunks = []
    for await (const chunk of p.stream([{ role: "user", content: "hi" }])) chunks.push(chunk)
    expect(chunks[chunks.length - 1]!.done).toBe(true)
    expect(chunks[chunks.length - 1]!.finishReason).toBe("refusal")
  })

  it("streaming: no refusal events leaves finishReason undefined", async () => {
    const p = openaiResponsesProvider(
      new FakeOpenAIResponsesStream([{ type: "response.completed" }]),
    )
    const chunks = []
    for await (const chunk of p.stream([{ role: "user", content: "hi" }])) chunks.push(chunk)
    expect(chunks[chunks.length - 1]!.finishReason).toBeUndefined()
  })
})
