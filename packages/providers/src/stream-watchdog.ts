// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Provider-level stream-watchdog adapter (minimax f07e6ef borrowing).
 *
 * Wraps a {@link Provider} so EVERY physical request attempt — including
 * every retry attempt made by `withRetry` when this wrapper sits inside it —
 * is guarded by two bounds from `@max/llm`:
 *
 *   - `firstEventTimeoutMs`: wait for the first stream event / the whole
 *     non-streaming chat call.
 *   - `idleTimeoutMs`: maximum gap between stream events after the first
 *     one. A per-call `ChatOptions.streamIdleTimeoutMs` overrides the base
 *     bound for that call.
 *
 * On a bound firing the attempt is aborted through a watchdog-owned signal
 * and ends with a retryable timeout Error (message carries "timed out"), so
 * `withRetry`'s classifier retries the attempt instead of failing the call.
 * A provider that ignores the abort cannot hang the wrapper: the read loop
 * races a stop signal and drops the abandoned stream.
 *
 * Wrap it INSIDE retry so each attempt is guarded independently:
 *   `withCircuitBreaker(withRetry(withLLMStreamTimeouts(withSseGuard(p))))`
 */

import type { Provider, ChatMessage, ChatOptions, ChatChunk } from "./base.js"
import {
  guardedLLMCall,
  guardedLLMStream,
  resolveLLMStreamTimeouts,
  type LLMStreamTimeoutConfig,
  type LLMStreamTimeouts,
} from "@max/llm"

export function withLLMStreamTimeouts(
  provider: Provider,
  config: LLMStreamTimeoutConfig = {},
): Provider {
  const base: LLMStreamTimeouts = resolveLLMStreamTimeouts(config)

  async function* watchedStream(
    messages: ChatMessage[],
    options: ChatOptions | undefined,
  ): AsyncIterable<ChatChunk> {
    const timeouts: LLMStreamTimeouts = {
      firstEventTimeoutMs: base.firstEventTimeoutMs,
      idleTimeoutMs: options?.streamIdleTimeoutMs ?? base.idleTimeoutMs,
    }
    yield* guardedLLMStream(
      (signal) => provider.stream(messages, { ...(options ?? {}), signal }),
      timeouts,
      options?.signal,
    )
  }

  return {
    get id() {
      return provider.id
    },
    get name() {
      return provider.name
    },
    get defaultModel() {
      return provider.defaultModel
    },
    chat(messages, options) {
      return guardedLLMCall(
        (signal) => provider.chat(messages, { ...(options ?? {}), signal }),
        base.firstEventTimeoutMs,
        options?.signal,
      )
    },
    stream: watchedStream,
    embeddings: provider.embeddings
      ? (input, model) =>
          guardedLLMCall(() => provider.embeddings!(input, model), base.firstEventTimeoutMs)
      : undefined,
    isConfigured: () => provider.isConfigured(),
  }
}
