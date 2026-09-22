// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Aux-call hardening (hermes borrowing: auxiliary_reasoning_floor /
 * auxiliary_structured_output / fallback_cooldown / moa_alternation).
 *
 * Three defensive utilities for provider calls that fail in
 * model-configuration-specific ways — the fix in every case is to REMEMBER
 * the capability/rejection and pre-empt it on subsequent calls instead of
 * re-discovering it per request:
 *
 *  - CapabilityMemo: (endpoint/model, capability) → rejected. Once a
 *    structured-output field (or other optional param) is refused, drop it
 *    BEFORE the next request — distinguishing capability rejections from
 *    schema-validation 400s (only the former is memoized).
 *  - FallbackCooldown: when leaving the primary provider due to repeated
 *    429s, arm an exponential cooldown (60s → 2m → … → 4h cap) so the aux
 *    chain is not hammered; arming only happens on chain LEAVE, so a
 *    chain switch never punishes a healthy provider.
 *  - mergeAdjacentSameRole: strict role-alternation templates (llama.cpp /
 *    vLLM / Mistral) 400 on adjacent same-role messages; merge them and
 *    remember the endpoint needs pre-merging.
 */

export class CapabilityMemo {
  private rejected = new Set<string>()

  private static key(scope: string, capability: string): string {
    return `${scope}|${capability}`
  }

  /** Was this (scope, capability) combination rejected as unsupported before? */
  isUnsupported(scope: string, capability: string): boolean {
    return this.rejected.has(CapabilityMemo.key(scope, capability))
  }

  /**
   * Record a capability rejection. Call ONLY for capability-style
   * rejections (provider says "response_format not supported",
   * "unknown parameter", …) — never for schema-validation 400s, which are
   * our bug, not the model's limitation.
   */
  recordRejection(scope: string, capability: string): void {
    this.rejected.add(CapabilityMemo.key(scope, capability))
  }
}

export class FallbackCooldown {
  private armedUntil = new Map<string, number>()
  private stage = new Map<string, number>()

  constructor(
    /** Base cooldown when the primary chain 429s. Default 60s. */
    private baseDelayMs = 60_000,
    /** Hard cap. Default 4h. */
    private maxDelayMs = 4 * 60 * 60_000,
    private now: () => number = Date.now,
  ) {}

  /**
   * Arm (or escalate) the cooldown for a provider key. Call ONLY when
   * leaving the primary chain due to repeated 429s — escalating on a mere
   * chain switch would cool down a healthy provider.
   */
  arm(providerKey: string): number {
    const stage = (this.stage.get(providerKey) ?? 0) + 1
    this.stage.set(providerKey, stage)
    const delay = Math.min(this.baseDelayMs * 2 ** (stage - 1), this.maxDelayMs)
    this.armedUntil.set(providerKey, this.now() + delay)
    return delay
  }

  /** Is the provider inside its cooldown window? */
  isCooling(providerKey: string): boolean {
    const until = this.armedUntil.get(providerKey)
    return until !== undefined && this.now() < until
  }

  /** Disarm (e.g. a successful manual call proves the provider healthy again). */
  disarm(providerKey: string): void {
    this.armedUntil.delete(providerKey)
    this.stage.delete(providerKey)
  }
}

/**
 * Merge adjacent same-role messages (hermes moa_alternation borrowing).
 * Strict role-alternation templates reject requests where two consecutive
 * messages share a role; their content is concatenated with a blank line.
 */
export function mergeAdjacentSameRole<T extends { role: string }>(messages: T[]): T[] {
  const out: T[] = []
  for (const m of messages) {
    const last = out[out.length - 1]
    if (last && last.role === m.role) {
      const lastAny = last as unknown as { content?: unknown }
      if (
        typeof lastAny.content === "string" &&
        typeof (m as unknown as { content?: unknown }).content === "string"
      ) {
        lastAny.content = `${lastAny.content}\n\n${(m as unknown as { content: string }).content}`
      } else {
        out.push({ ...m })
      }
      continue
    }
    out.push({ ...m })
  }
  return out
}

/** Does this provider error look like a role-alternation 400? */
export function isRoleAlternationError(message: string): boolean {
  return /role alternation|must alternate|consecutive (messages|roles)/i.test(message)
}
