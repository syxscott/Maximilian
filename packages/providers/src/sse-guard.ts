// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * SSE guard — header/chunk dual timeout + cancel propagation.
 *
 * Borrowed from opencode `packages/opencode/src/provider/provider.ts`
 * (`wrapSSE` / `timeoutController`): a hanging SSE connection is worse
 * than a failed one — the caller waits forever. Two independent windows:
 *
 *   - **header timeout**: armed while waiting for the first chunk. No
 *     bytes at all within the window → fail fast.
 *   - **chunk timeout**: re-armed on every chunk. A mid-stream stall fails
 *     the stream instead of pinning the task.
 *
 * The wait races `iterator.next()` against the window timer, so a stall
 * actually interrupts the pending read. On any early exit (timeout,
 * consumer `break`, error) the upstream iterator's `return()` is invoked
 * so the underlying HTTP body is aborted rather than abandoned — opencode's
 * "SSE reader cancel rejection" fix.
 *
 * Defaults: 5 minutes for both windows (opencode's current defaults).
 */

export class SseTimeoutError extends Error {
  readonly phase: "headers" | "chunk"
  readonly timeoutMs: number

  constructor(phase: "headers" | "chunk", timeoutMs: number) {
    super(`SSE ${phase} timeout after ${timeoutMs}ms`)
    this.name = "SseTimeoutError"
    this.phase = phase
    this.timeoutMs = timeoutMs
  }
}

export interface SseGuardOptions {
  /** Max wait for the first chunk. Default 5 min. */
  headerTimeoutMs?: number
  /** Max gap between chunks. Default 5 min. */
  chunkTimeoutMs?: number
}

import type { Provider, ChatMessage, ChatOptions, ChatChunk, EmbeddingResponse } from "./base.js"

/**
 * Provider decorator: run every `stream()` through `guardSse` so a stalled
 * SSE connection fails the task instead of pinning it forever. Compose
 * innermost: `withCircuitBreaker(withRetry(withSseGuard(p)))` — retry's
 * `isRetryable` matches the "…timeout" message shape, so a guard timeout
 * is retried as a transient network-class failure (regression-tested in
 * retry-sse.test.ts).
 */
export function withSseGuard(provider: Provider, opts: SseGuardOptions = {}): Provider {
  function retryStream(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<ChatChunk> {
    return guardSse(provider.stream(messages, options), opts)
  }
  function retryEmbeddings(input: string | string[], model?: string): Promise<EmbeddingResponse> {
    if (!provider.embeddings) throw new Error("Provider does not support embeddings")
    return provider.embeddings(input, model)
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
    chat: (messages: ChatMessage[], options?: ChatOptions) => provider.chat(messages, options),
    stream: retryStream,
    embeddings: provider.embeddings ? retryEmbeddings : undefined,
    isConfigured: provider.isConfigured.bind(provider),
  }
}

/**
 * Wrap an async iterable so stalls become errors. Fails with
 * `SseTimeoutError` when the first chunk or any inter-chunk gap exceeds
 * the configured windows.
 */
export async function* guardSse<T>(
  stream: AsyncIterable<T>,
  opts: SseGuardOptions = {},
): AsyncIterable<T> {
  const headerTimeoutMs = opts.headerTimeoutMs ?? 300_000
  const chunkTimeoutMs = opts.chunkTimeoutMs ?? 300_000
  const iterator = stream[Symbol.asyncIterator]()
  let phase: "headers" | "chunk" = "headers"

  try {
    while (true) {
      const timeoutMs = phase === "headers" ? headerTimeoutMs : chunkTimeoutMs
      let fire: (err: unknown) => void = () => {}
      const timeoutPromise = new Promise<never>((_, reject) => {
        fire = reject
      })
      const timer = setTimeout(() => fire(new SseTimeoutError(phase, timeoutMs)), timeoutMs)
      timer.unref?.()

      let result: IteratorResult<T>
      try {
        result = await Promise.race([iterator.next(), timeoutPromise])
      } catch (err) {
        // Timeout fired (or upstream failed) — abort the upstream body and
        // rethrow the original error.
        try {
          await iterator.return?.(undefined as never)
        } catch {
          // the original error wins over a close-time rejection
        }
        throw err
      } finally {
        clearTimeout(timer)
      }

      if (result.done) return
      phase = "chunk"
      yield result.value
    }
  } finally {
    // Consumer broke out early (or we returned) — make sure the upstream
    // connection is closed rather than left hanging.
    try {
      await iterator.return?.(undefined as never)
    } catch {
      // nothing to propagate on a clean consumer exit
    }
  }
}
