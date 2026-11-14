// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * apiFormat-level capability Declaration (OpenAgentCore
 * internal/harnessconfig/harness.go Declaration borrowing).
 *
 * Before this module, what a wire format can do was stated in fragments:
 * the format classes implicitly (which optional parameters they map),
 * capability-predicates.ts (which model families REJECT a parameter) and
 * the registry's wrapper stack (what it needs from every provider). Nothing
 * said plainly, in one place, what each apiFormat supports — so admission
 * checks and runtime gates could drift apart.
 *
 * The harness.go rule this module ports: ONE Declaration per format states
 * its capabilities; Core admission validates against that same value; and
 * runtime discovery may NARROW the effective set (a capability probed as
 * missing is removed) and NEVER widen it — there is deliberately no API
 * that adds a capability back.
 *
 * Gradual adoption: existing structures are untouched. The Declaration is
 * consumed today by
 *   1. admission — `createProviderForFormat` refuses a provider whose
 *      `requires` list is not covered by the declaration (registry passes
 *      its wrapper-stack minimum), and
 *   2. the runtime wire gate — `wireStopSequences` consults the EFFECTIVE
 *      (declared minus narrowed) set; a narrowed format degrades to the
 *      client-side stop-word fallback instead of provoking wire 400s.
 *
 * The model-id-level rejection table in capability-predicates.ts remains
 * the finer layer beneath this coarse format-level gate (its 2026-10
 * semantics are unchanged).
 */

import type { ApiFormat } from "./presets/types.js"

/**
 * Capabilities a wire format can declare. Declared = the adapter actually
 * maps the capability onto THIS wire — not "the protocol has a field for
 * it". `tools` is part of the model but declared nowhere today: no format
 * adapter wires tool calling yet, and admitting a provider that relies on
 * it would break every call.
 */
export type ApiFormatCapability =
  /** `stream()` drains real wire chunks (idle watchdogs + SSE guard apply). */
  | "streaming"
  /** Tool/function calling is wired onto the request. */
  | "tools"
  /** The embeddings endpoint is implemented for this format. */
  | "embeddings"
  /** Native stop-sequence parameter mapping (`wireStopSequences` passes). */
  | "stopSequences"
  /** Streamed chunks carry the terminal usage breakdown (streamUsage gate). */
  | "streamUsage"
  /** The adapter maps the output limit (options.maxTokens) to a native parameter (限额映射). */
  | "maxOutputTokens"

/**
 * The single Declaration of an apiFormat (harnessconfig borrowing):
 * authored once, consumed by admission and runtime gates alike.
 */
export interface ApiFormatDeclaration {
  readonly format: ApiFormat
  /** Capabilities the adapter maps onto this wire. The zero value is invalid. */
  readonly capabilities: readonly ApiFormatCapability[]
  /**
   * 限额映射: true when the wire REQUIRES an output-limit value on every
   * request (Anthropic `max_tokens` is mandatory; omitting it is a 400,
   * not an omitable parameter).
   */
  readonly requiresMaxOutputTokens: boolean
  /**
   * Fallback output limit that satisfies a `requiresMaxOutputTokens` wire.
   * Lives here — not as a bare literal in the format class — so the limit
   * mapping is stated once, with the requirement it exists to satisfy.
   */
  readonly maxOutputTokensFallback?: number
}

/**
 * THE declarations. Authored once; every admission check and runtime gate
 * reads this table.
 */
export const API_FORMAT_DECLARATIONS: Readonly<Record<ApiFormat, ApiFormatDeclaration>> =
  Object.freeze({
    openai_chat: Object.freeze({
      format: "openai_chat" as const,
      capabilities: Object.freeze([
        "streaming",
        "embeddings",
        "stopSequences",
        "streamUsage",
        "maxOutputTokens",
      ] as readonly ApiFormatCapability[]),
      requiresMaxOutputTokens: false,
    }),
    anthropic: Object.freeze({
      format: "anthropic" as const,
      capabilities: Object.freeze([
        "streaming",
        "stopSequences",
        "streamUsage",
        "maxOutputTokens",
      ] as readonly ApiFormatCapability[]),
      requiresMaxOutputTokens: true,
      maxOutputTokensFallback: 4096,
    }),
    gemini_native: Object.freeze({
      format: "gemini_native" as const,
      capabilities: Object.freeze([
        "streaming",
        "stopSequences",
        "maxOutputTokens",
      ] as readonly ApiFormatCapability[]),
      requiresMaxOutputTokens: false,
    }),
    openai_responses: Object.freeze({
      format: "openai_responses" as const,
      capabilities: Object.freeze([
        "streaming",
        "maxOutputTokens",
      ] as readonly ApiFormatCapability[]),
      requiresMaxOutputTokens: false,
    }),
  })

/** Admission failure: a required capability is not in the Declaration. */
export class FormatCapabilityError extends Error {
  constructor(
    public readonly format: ApiFormat,
    public readonly capability: ApiFormatCapability,
    message: string,
  ) {
    super(message)
    this.name = "FormatCapabilityError"
  }
}

/**
 * The Declaration for a format. Unknown apiFormat is a programmer error —
 * the format factory already treats it the same way.
 */
export function declarationForFormat(format: ApiFormat): ApiFormatDeclaration {
  const declaration = API_FORMAT_DECLARATIONS[format]
  if (!declaration) {
    throw new FormatCapabilityError(
      format,
      "streaming",
      `No capability declaration for apiFormat: ${String(format)}`,
    )
  }
  return declaration
}

/** Capabilities the format DECLARES (before any runtime narrowing). */
export function declaredCapabilities(format: ApiFormat): ReadonlySet<ApiFormatCapability> {
  return new Set(declarationForFormat(format).capabilities)
}

// Runtime narrowing state (harnessconfig borrowing: "Runtime discovery may
// narrow Capabilities for the installed host ... and never widens them").
// Module-level per format — the capability is a property of the wire
// dialect, shared by every provider speaking it, mirroring the registry's
// singleton scope.
const runtimeNarrowed = new Map<ApiFormat, Set<ApiFormatCapability>>()

/**
 * Record a runtime-observed MISSING capability (narrow-only). The probe may
 * only report capabilities the format actually declares — reporting an
 * undeclared one is a probe bug and throws. There is no counterpart that
 * re-adds a capability: narrowing is one-way by construction.
 */
export function noteRuntimeCapabilityMissing(
  format: ApiFormat,
  capability: ApiFormatCapability,
): void {
  const declared = declaredCapabilities(format)
  if (!declared.has(capability)) {
    throw new FormatCapabilityError(
      format,
      capability,
      `Cannot narrow undeclared capability "${capability}" on ${format}: runtime discovery may only narrow declared capabilities`,
    )
  }
  let narrowed = runtimeNarrowed.get(format)
  if (!narrowed) {
    narrowed = new Set()
    runtimeNarrowed.set(format, narrowed)
  }
  narrowed.add(capability)
}

/** Capabilities narrowed away by runtime probes for this format. */
export function runtimeNarrowedCapabilities(format: ApiFormat): ReadonlySet<ApiFormatCapability> {
  return new Set(runtimeNarrowed.get(format) ?? [])
}

/**
 * The EFFECTIVE capability set: declared minus runtime-narrowed. Admission
 * and runtime gates read this — never the raw declaration — so a probed
 * degradation applies to every provider speaking the format.
 */
export function effectiveFormatCapabilities(format: ApiFormat): ReadonlySet<ApiFormatCapability> {
  const declared = declaredCapabilities(format)
  const narrowed = runtimeNarrowed.get(format)
  if (!narrowed || narrowed.size === 0) return declared
  const effective = new Set(declared)
  for (const capability of narrowed) effective.delete(capability)
  return effective
}

/**
 * Whether the format still supports `capability` after runtime narrowing.
 */
export function formatSupports(format: ApiFormat, capability: ApiFormatCapability): boolean {
  return effectiveFormatCapabilities(format).has(capability)
}

/**
 * Admission check (harnessconfig borrowing: "Core admission validates every
 * Session against it; Core keeps no parallel per-Harness description").
 * Throws {@link FormatCapabilityError} when any required capability is not
 * in the format's EFFECTIVE capability set — a provider whose declaration
 * does not carry the capability is refused, not built half-working.
 */
export function assertFormatAdmission(
  format: ApiFormat,
  required: readonly ApiFormatCapability[],
): void {
  const effective = effectiveFormatCapabilities(format)
  for (const capability of required) {
    if (!effective.has(capability)) {
      throw new FormatCapabilityError(
        format,
        capability,
        `${format} declaration does not include capability "${capability}" — provider admission refused`,
      )
    }
  }
}

/** Test seam: clear all runtime narrowing (the Declaration itself is frozen). */
export function resetRuntimeCapabilityNarrowing(): void {
  runtimeNarrowed.clear()
}
