// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Model capability predicates + client-side fallbacks (crewAI 107fab8c8
 * supports_stop_words borrowing).
 *
 * Some model families reject an OPTIONAL request parameter with a hard 400 —
 * OpenAI-hosted models on Bedrock (`openai.gpt-oss-*`, `us.openai.gpt-6-*`)
 * reject `inferenceConfig.stopSequences` — while agent frameworks attach a
 * stop word (e.g. "\nObservation:") to every call, so the whole agent fails
 * on those models. The fix is two-sided and the predicate table is the single
 * source of truth for both:
 *
 *   1. Wire gate: {@link supportsStopSequences} is false → the parameter is
 *      NOT sent (`wireStopSequences` returns undefined) instead of provoking
 *      the deterministic 400.
 *   2. Client fallback: the semantics are still honored client-side —
 *      {@link applyStopWordsClientSide} truncates the result at the earliest
 *      stop sequence. Test contract: the parameter is not sent AND the
 *      result is still truncated.
 *
 * Predicates match on model-id patterns so new catalog entries pick the
 * right behavior without code changes.
 */

/**
 * Model-id families with known parameter rejections. A rejection entry is
 * per-capability so each parameter's evidence stays separate.
 */
const CAPABILITY_REJECTIONS: ReadonlyArray<{
  readonly capability: "stopSequences"
  /** Model-id pattern of the rejecting family. */
  readonly pattern: RegExp
  /** Why the family rejects the parameter (for logs/tests). */
  readonly reason: string
}> = [
  {
    capability: "stopSequences",
    // Bedrock's OpenAI-hosted family: "openai.gpt-oss-120b-1:0",
    // "us.openai.gpt-6-sol", "global.openai.gpt-6-luna". The literal
    // "openai." segment is the API's own namespace prefix — plain
    // "openai/gpt-5" or "gpt-5.6" ids do NOT match.
    pattern: /(?:^|[^a-z0-9])openai\./i,
    reason: "OpenAI-hosted models on Bedrock reject inferenceConfig.stopSequences with HTTP 400",
  },
]

/**
 * True when the model accepts stop sequences on the wire. Unknown models
 * default to true — the wire gate only closes for families with EVIDENCE of
 * a rejection.
 */
export function supportsStopSequences(modelId: string | undefined): boolean {
  if (!modelId) return true
  return !CAPABILITY_REJECTIONS.some(
    (entry) => entry.capability === "stopSequences" && entry.pattern.test(modelId),
  )
}

/**
 * Wire gate: the stop sequences to send for `modelId`, or undefined when the
 * model family rejects them (the parameter is omitted entirely) or none were
 * requested.
 */
export function wireStopSequences(
  modelId: string | undefined,
  stopSequences: string[] | undefined,
): string[] | undefined {
  if (!stopSequences || stopSequences.length === 0) return undefined
  if (!supportsStopSequences(modelId)) return undefined
  return stopSequences
}

/**
 * Earliest index in `text` at which any stop sequence begins, or -1.
 */
function earliestStopHit(text: string, stopSequences: readonly string[]): number {
  let cut = -1
  for (const seq of stopSequences) {
    if (seq.length === 0) continue
    const at = text.indexOf(seq)
    if (at !== -1 && (cut === -1 || at < cut)) cut = at
  }
  return cut
}

/**
 * Client-side stop-word fallback (crewAI _apply_stop_words borrowing):
 * truncate the completion at the EARLIEST occurrence of any stop sequence.
 * Providers that honored the wire parameter already stopped before the
 * sequence appeared, so applying this unconditionally is idempotent — and it
 * is what keeps the semantics intact for models where the parameter was
 * gated off the wire.
 */
export function applyStopWordsClientSide(
  text: string,
  stopSequences: string[] | undefined,
): string {
  if (!stopSequences || stopSequences.length === 0 || text.length === 0) return text
  const cut = earliestStopHit(text, stopSequences)
  return cut === -1 ? text : text.slice(0, cut)
}

/**
 * Chunk-stream client-side truncation: stop sequences can straddle chunk
 * boundaries, so deltas are accumulated and only the portion before the
 * earliest hit is emitted. Once a hit closes the stream, later deltas are
 * dropped while the terminal chunk (finishReason/usage) still passes through.
 */
export async function* applyStopWordsToChunkStream(
  chunks: AsyncIterable<import("./base.js").ChatChunk>,
  stopSequences: string[] | undefined,
): AsyncGenerator<import("./base.js").ChatChunk, void, void> {
  if (!stopSequences || stopSequences.length === 0) {
    yield* chunks
    return
  }
  let received = ""
  let emittedUpTo = 0
  let truncated = false
  for await (const chunk of chunks) {
    if (truncated) {
      // The stream is semantically over; only the terminal metadata passes.
      if (chunk.done) {
        yield { ...chunk, delta: "" }
        return
      }
      continue
    }
    received += chunk.delta
    const cut = earliestStopHit(received, stopSequences)
    if (cut !== -1) {
      truncated = true
      yield { ...chunk, delta: received.slice(emittedUpTo, cut), done: true }
      return
    }
    // Hold back a tail that could still be the prefix of a stop sequence.
    const safeUpTo = safeEmitBound(received, stopSequences)
    if (safeUpTo > emittedUpTo) {
      const out = received.slice(emittedUpTo, safeUpTo)
      emittedUpTo = safeUpTo
      yield { ...chunk, delta: out, done: chunk.done }
      if (chunk.done) return
    } else if (chunk.done) {
      yield { ...chunk, delta: "", done: true }
      return
    }
  }
}

/**
 * Length of `received` that can be emitted safely: everything except a tail
 * that is a proper prefix of some stop sequence (that tail may grow into a
 * full stop sequence with the next chunk).
 */
function safeEmitBound(received: string, stopSequences: readonly string[]): number {
  let bound = received.length
  for (const seq of stopSequences) {
    const maxPrefix = Math.min(seq.length - 1, received.length)
    for (let len = maxPrefix; len >= 1; len--) {
      if (received.endsWith(seq.slice(0, len))) {
        bound = Math.min(bound, received.length - len)
        break
      }
    }
  }
  return Math.max(bound, 0)
}

/**
 * Provider decorator applying the client-side stop-word fallback to chat
 * responses and stream deltas. Pair it with the wire gates in the format
 * layers (`wireStopSequences`) so the parameter is never sent to a rejecting
 * family yet the results are still truncated.
 */
export function withClientSideStopSequences(
  provider: import("./base.js").Provider,
): import("./base.js").Provider {
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
    async chat(messages, options) {
      const response = await provider.chat(messages, options)
      const stop = options?.stopSequences
      if (!stop || stop.length === 0) return response
      return { ...response, content: applyStopWordsClientSide(response.content, stop) }
    },
    stream(messages, options) {
      return applyStopWordsToChunkStream(provider.stream(messages, options), options?.stopSequences)
    },
    embeddings: provider.embeddings?.bind(provider),
    isConfigured: () => provider.isConfigured(),
  }
}
