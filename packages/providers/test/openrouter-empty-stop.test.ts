// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * OpenRouter empty-stop detection (pi #12407 borrowing:
 * borrowings/pi packages/ai/src/utils/openrouter-finish-reason.ts:44-69 +
 * packages/ai/src/api/openai-completions.ts:706 stream-end integration).
 *
 * Contracts under test:
 *   - a stream that ends with `finish_reason: "stop"` and no visible output
 *     (reasoning alone does not count) throws a retryable EMPTY_RESPONSE
 *     ProviderError when `native_finish_reason` is a failure;
 *   - clean native reasons, text/refusal/tool-call output, a missing native
 *     reason, and non-OpenRouter provider ids all complete normally;
 *   - the thrown error is honored by the retry layer (EMPTY_RESPONSE is a
 *     default-retryable code).
 */
import { describe, expect, it } from "vitest"
import { OpenAIChatProvider } from "../src/formats/openai-chat.js"
import {
  CLEAN_STOP_NATIVE_REASONS,
  isEmptyOpenRouterStop,
  openRouterEmptyStopMessage,
  readOpenRouterNativeFinishReason,
} from "../src/formats/openrouter-finish-reason.js"
import { ProviderError, type ChatChunk, type ChatMessage } from "../src/base.js"
import { withRetry } from "../src/retry.js"
import { DEFAULT_RETRYABLE_CODES } from "../src/retry-policy.js"

const messages: ChatMessage[] = [{ role: "user", content: "hi" }]

function openRouter(id = "openrouter"): OpenAIChatProvider {
  return new OpenAIChatProvider({
    id,
    name: id,
    apiKey: "k",
    baseURL: "https://openrouter.ai/api/v1",
    defaultModel: "google/gemini-4-neon",
  })
}

function streamOf(chunks: ReadonlyArray<unknown>): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<unknown> {
      for (const chunk of chunks) yield chunk
    },
  }
}

/** Swap the private SDK client for one streaming `chunks`; counts create() calls. */
function injectStream(
  p: OpenAIChatProvider,
  chunks: ReadonlyArray<unknown>,
  onCreate?: () => void,
): void {
  ;(p as unknown as { client: unknown }).client = {
    chat: {
      completions: {
        create: async () => {
          onCreate?.()
          return streamOf(chunks)
        },
      },
    },
  }
}

interface DrainResult {
  chunks: ChatChunk[]
  error: unknown
}

async function drain(iterable: AsyncIterable<ChatChunk>): Promise<DrainResult> {
  const chunks: ChatChunk[] = []
  try {
    for await (const chunk of iterable) chunks.push(chunk)
    return { chunks, error: undefined }
  } catch (error) {
    return { chunks, error }
  }
}

const REASONING_THEN_MALFORMED: ReadonlyArray<unknown> = [
  {
    id: "gen-1",
    choices: [{ index: 0, delta: { reasoning: "Let me think." }, finish_reason: null }],
  },
  {
    id: "gen-1",
    choices: [
      { index: 0, delta: {}, finish_reason: "stop", native_finish_reason: "MALFORMED_RESPONSE" },
    ],
  },
]

describe("isEmptyOpenRouterStop / whitelist", () => {
  it("flags an empty stop with a failure native reason", () => {
    expect(
      isEmptyOpenRouterStop({
        finishReason: "stop",
        nativeFinishReason: "MALFORMED_RESPONSE",
        hasVisibleOutput: false,
      }),
    ).toBe(true)
  })

  it("does not flag a stop with visible output", () => {
    expect(
      isEmptyOpenRouterStop({
        finishReason: "stop",
        nativeFinishReason: "MALFORMED_RESPONSE",
        hasVisibleOutput: true,
      }),
    ).toBe(false)
  })

  it("does not flag clean reasons (case-insensitive) or missing/non-stop finishes", () => {
    for (const clean of ["stop", "end_turn", "End_Turn", "EOS", "completed"]) {
      expect(
        isEmptyOpenRouterStop({
          finishReason: "stop",
          nativeFinishReason: clean,
          hasVisibleOutput: false,
        }),
        clean,
      ).toBe(false)
    }
    expect(
      isEmptyOpenRouterStop({
        finishReason: "stop",
        nativeFinishReason: undefined,
        hasVisibleOutput: false,
      }),
    ).toBe(false)
    expect(
      isEmptyOpenRouterStop({
        finishReason: "tool_calls",
        nativeFinishReason: "MALFORMED_RESPONSE",
        hasVisibleOutput: false,
      }),
    ).toBe(false)
  })

  it("keeps the pi allowlist entries and excludes documented failures", () => {
    expect(CLEAN_STOP_NATIVE_REASONS).toContain("end_turn")
    expect(CLEAN_STOP_NATIVE_REASONS).toContain("pause_turn")
    expect(CLEAN_STOP_NATIVE_REASONS).not.toContain("MALFORMED_RESPONSE")
    // Deliberately excluded upstream-documented failures (see module comment).
    expect(CLEAN_STOP_NATIVE_REASONS).not.toContain("OTHER")
    expect(CLEAN_STOP_NATIVE_REASONS).not.toContain("insufficient_system_resource")
  })

  it("reads a non-empty native_finish_reason and rejects other wire shapes", () => {
    expect(readOpenRouterNativeFinishReason({ native_finish_reason: "STOP" })).toBe("STOP")
    expect(readOpenRouterNativeFinishReason({ native_finish_reason: "" })).toBeUndefined()
    expect(readOpenRouterNativeFinishReason({ native_finish_reason: 42 })).toBeUndefined()
    expect(readOpenRouterNativeFinishReason({})).toBeUndefined()
  })

  it("builds the stable empty-response message", () => {
    expect(openRouterEmptyStopMessage("MALFORMED_RESPONSE")).toBe(
      "OpenRouter returned an empty response (native_finish_reason: MALFORMED_RESPONSE)",
    )
  })
})

describe("openai-chat stream — OpenRouter empty stop", () => {
  it("throws a retryable EMPTY_RESPONSE after reasoning-only output", async () => {
    const p = openRouter()
    injectStream(p, REASONING_THEN_MALFORMED)
    const { chunks, error } = await drain(p.stream(messages))
    expect(error).toBeInstanceOf(ProviderError)
    expect(error).toMatchObject({
      providerId: "openrouter",
      statusCode: undefined,
      code: "EMPTY_RESPONSE",
      retryable: true,
    })
    expect((error as Error).message).toContain("native_finish_reason: MALFORMED_RESPONSE")
    // The failure replaces the terminal done chunk instead of ending silently.
    expect(chunks.some((chunk) => chunk.done)).toBe(false)
  })

  it("completes normally when text was streamed before the failure stop", async () => {
    const p = openRouter()
    injectStream(p, [
      { id: "gen-2", choices: [{ index: 0, delta: { content: "Done." }, finish_reason: null }] },
      {
        id: "gen-2",
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: "stop",
            native_finish_reason: "MALFORMED_RESPONSE",
          },
        ],
      },
    ])
    const { chunks, error } = await drain(p.stream(messages))
    expect(error).toBeUndefined()
    expect(chunks[0]?.delta).toBe("Done.")
    expect(chunks.at(-1)?.done).toBe(true)
    expect(chunks.at(-1)?.finishReason).toBe("stop")
  })

  it("treats whitespace-only text as no visible output", async () => {
    const p = openRouter()
    injectStream(p, [
      { id: "gen-3", choices: [{ index: 0, delta: { content: "   " }, finish_reason: null }] },
      {
        id: "gen-3",
        choices: [{ index: 0, delta: {}, finish_reason: "stop", native_finish_reason: "OTHER" }],
      },
    ])
    const { error } = await drain(p.stream(messages))
    expect(error).toMatchObject({ code: "EMPTY_RESPONSE", retryable: true })
  })

  it("keeps an empty stop whose native reason is a clean stop", async () => {
    const p = openRouter()
    injectStream(p, [
      {
        id: "gen-4",
        choices: [{ index: 0, delta: {}, finish_reason: "stop", native_finish_reason: "end_turn" }],
      },
    ])
    const { chunks, error } = await drain(p.stream(messages))
    expect(error).toBeUndefined()
    expect(chunks.at(-1)?.done).toBe(true)
  })

  it("does not flag an empty stop without a native reason (ambiguous)", async () => {
    const p = openRouter()
    injectStream(p, [{ id: "gen-5", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }])
    const { error } = await drain(p.stream(messages))
    expect(error).toBeUndefined()
  })

  it("counts tool-call and refusal output as visible", async () => {
    const p = openRouter()
    injectStream(p, [
      {
        id: "gen-6",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, id: "call_1", function: { name: "read", arguments: "{}" } }],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: "gen-6",
        choices: [{ index: 0, delta: {}, finish_reason: "stop", native_finish_reason: "OTHER" }],
      },
    ])
    expect((await drain(p.stream(messages))).error).toBeUndefined()

    const q = openRouter()
    injectStream(q, [
      {
        id: "gen-7",
        choices: [
          { index: 0, delta: { refusal: "I cannot help with that." }, finish_reason: null },
        ],
      },
      {
        id: "gen-7",
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: "stop",
            native_finish_reason: "MALFORMED_RESPONSE",
          },
        ],
      },
    ])
    expect((await drain(q.stream(messages))).error).toBeUndefined()
  })

  it("ignores native_finish_reason on providers outside the OpenRouter id family", async () => {
    for (const id of ["openai", "deepseek", "zhipu"]) {
      const p = openRouter(id)
      injectStream(p, REASONING_THEN_MALFORMED)
      const { error } = await drain(p.stream(messages))
      expect(error, id).toBeUndefined()
    }
  })

  it("applies the guard to every OpenRouter preset id", async () => {
    for (const id of ["openrouter", "openrouter-2", "openrouter-v"]) {
      const p = openRouter(id)
      injectStream(p, REASONING_THEN_MALFORMED)
      const { error } = await drain(p.stream(messages))
      expect(error, id).toMatchObject({ code: "EMPTY_RESPONSE", retryable: true })
    }
  })
})

describe("retry policy — EMPTY_RESPONSE is retryable", () => {
  it("lists EMPTY_RESPONSE among the default retryable codes", () => {
    expect(DEFAULT_RETRYABLE_CODES).toContain("EMPTY_RESPONSE")
  })

  it("retries the thrown empty-stop error up to maxAttempts", async () => {
    const p = openRouter()
    let attempts = 0
    injectStream(p, REASONING_THEN_MALFORMED, () => {
      attempts += 1
    })
    const resilient = withRetry(p, { maxAttempts: 2, baseDelay: 1, sleep: async () => {} })
    const { error } = await drain(resilient.stream(messages))
    expect(attempts).toBe(2)
    expect(error).toBeInstanceOf(ProviderError)
    expect(error).toMatchObject({ code: "EMPTY_RESPONSE", retryable: true })
  })
})
