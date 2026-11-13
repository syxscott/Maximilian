// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Refusal settlement — the terminal-state semantics for safety-refused LLM
 * turns (deepseek chat-demo reply.ts borrowing).
 *
 * chat-demo semantics being ported:
 *   - `settleReply`: when `stopReason === 'refusal'`, the already-streamed
 *     thinking/text blocks cannot be retracted and MUST be discarded by the
 *     client — the turn is terminal and its partial body is untrusted.
 *   - `canContinueReply`: a refused reply can never continue (refusal leg),
 *     and generally only stopped/max_tokens replies may continue as a
 *     prefill prefix; replies with tool rounds or template text may not.
 *   - `isUsableReply`: refused rounds do not enter the context history.
 *
 * Maximilian mapping: providers surface the refusal as
 * `finishReason: "refusal"` (Anthropic `stop_reason`, OpenAI assistant
 * `refusal` field); the tool loop settles on it; the runtime persists
 * `Result.metadata.refused` and downstream context assembly annotates the
 * result instead of silently dropping the payload (audit keeps the raw
 * body; consumers must treat it as having no valid content).
 */

/** Canonical finishReason value every provider format maps a refusal to. */
export const REFUSAL_FINISH_REASON = "refusal"

/**
 * Context annotation for refused results (deepseek chat-demo reply.ts
 * isUsableReply borrowing — refused rounds do not re-enter the context as
 * trusted assistant turns). Mirrors the runtime's existing
 * `[unverified draft — ...]` failureDetector marker style.
 */
export const REFUSED_RESULT_MARKER = "[refused — do not rely on partial content]"

/**
 * Whether a finishReason marks a safety refusal (deepseek chat-demo reply.ts
 * settleReply borrowing). Refusals arrive as Anthropic `stop_reason: "refusal"`
 * and as a non-empty OpenAI assistant `refusal` field mapped by the provider
 * formats — this is the single predicate every consumer gates on.
 */
export function isRefusalFinish(finishReason?: string): boolean {
  return finishReason === REFUSAL_FINISH_REASON
}

/**
 * Minimal structural shape the settlement operates on. `ToolEnabledResponse`
 * satisfies it; kept structural so the module stays import-cycle-free.
 */
export interface RefusalSettleable {
  /**
   * Raw body as received. Preserved for audit (no physical deletion) but
   * protocol-untrusted after a refusal — downstream must treat it as having
   * no valid content.
   */
  content: string
  /** Tool calls parsed from the body; a refusal invalidates all of them. */
  toolCalls?: unknown[]
}

/**
 * Settle a refused response (deepseek chat-demo reply.ts settleReply
 * borrowing). Refusal is terminal: whatever body/tool-calls were parsed from
 * the partially streamed reply cannot be retracted and are untrusted by
 * protocol. The settlement keeps the raw payload for audit (we do not
 * physically delete it) but flags the result so downstream consumers treat
 * it as having no usable body, and clears parsed tool calls so no later
 * round executes content a refusal invalidated.
 */
export function settleRefusal<T extends RefusalSettleable>(
  response: T,
): T & { refused: true; toolCalls: unknown[] } {
  return {
    ...response,
    refused: true,
    toolCalls: [],
  }
}

/**
 * Refusal leg of the continuation gate (deepseek chat-demo reply.ts
 * canContinueReply borrowing): a refused turn can never be continued — by
 * protocol the client discards the partial content, so there is nothing
 * trustworthy to keep or prefix. Invariant: always false.
 */
export function canContinueAfterRefusal(): false {
  return false
}

/**
 * Full continuation eligibility (deepseek chat-demo reply.ts
 * canContinueReply borrowing), adapted to our structures.
 *
 * chat-demo's rule: only stopped/max_tokens replies continue as a prefill
 * prefix; refusal, tool rounds, and template text disqualify. Our
 * counterpart question: "may this settled response become the assistant
 * prefix of the next request's context?" The disqualification set carries
 * over verbatim — refusal (via {@link canContinueAfterRefusal}, always
 * false), an unfinished tool round (announced calls that were never
 * settled: our counterpart of chat-demo's tool_use / server-tool blocks),
 * and errored turns. The stopped/max_tokens allow-list collapses because
 * our prefix is context history rather than a prefill: complete turns
 * qualify too — but an empty body has nothing to append (isUsableReply
 * borrowing: failed or answer-less rounds do not enter the context).
 */
export interface ContinuationCandidate {
  /** Provider finishReason (stopReason on ToolEnabledResponse). */
  stopReason?: string
  /** Announced-but-unsettled tool calls — an unfinished tool round. */
  unsettledToolCalls?: number
  /** Turn ended in an error — never continuable. */
  errored?: boolean
  /** Raw body; a turn without content cannot serve as a prefix. */
  content?: string
}

export function canContinueAsPrefix(candidate: ContinuationCandidate): boolean {
  if (isRefusalFinish(candidate.stopReason)) {
    return canContinueAfterRefusal()
  }
  if ((candidate.unsettledToolCalls ?? 0) > 0) return false
  if (candidate.errored) return false
  return (candidate.content ?? "").trim() !== ""
}

/**
 * Read the refusal marker from a persisted `Result.metadata` record
 * (runtime seam). `Result.metadata` is an arbitrary key-value record, so
 * the marker is read defensively exactly like the runtime reads
 * `metadata.preflightResult`.
 */
export function isRefusedMetadata(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") return false
  return (metadata as { refused?: unknown }).refused === true
}

/**
 * Prefix a refused result's output with the refusal annotation (deepseek
 * chat-demo reply.ts isUsableReply borrowing). The payload stays visible
 * for audit but is marked the same way the runtime marks failureDetector-
 * flagged drafts. Idempotent: an already-marked output is returned as-is,
 * so layered callers (runtime priorResults assembly + review bundle) can
 * apply it without double-marking.
 */
export function annotateRefusalMarker<T extends { output: string; metadata?: unknown }>(
  result: T,
): T {
  if (!isRefusedMetadata(result.metadata)) return result
  if (result.output.startsWith(REFUSED_RESULT_MARKER)) return result
  return { ...result, output: `${REFUSED_RESULT_MARKER}\n${result.output}` }
}
