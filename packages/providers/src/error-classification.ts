// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Provider error classification: HTTP-status mapping, body-aware vendor
 * codes and trace-id capture.
 *
 * The status-only {@link classifyProviderError} cannot see vendor-specific
 * failure codes that providers return INSIDE a 2xx/4xx JSON body — MiniMax
 * answers `HTTP 200 {"base_resp":{"status_code":1028,...}}` for quota
 * exhaustion, and its OpenAI-style image API appends the vendor code to the
 * message: "…content safety check (1027)". It also cannot carry the
 * vendor's trace-id response header, which support asks for on every
 * ticket.
 *
 * Body-aware classification (MiniMax-MCP-JS src/utils/api.ts:92-107 + cli
 * src/errors/api.ts:52-179 mapApiErrorBase borrowing) reads the FULL error
 * facts:
 *   1. HTTP status precedence (cli order): 401/403 → AUTH, 429 →
 *      RATE_LIMIT (retryable), 402 → QUOTA.
 *   2. Vendor code extracted from the parsed body (`base_resp.status_code`,
 *      `error.code`) or from a trailing "(NNNN)" message code, mapped
 *      through an INJECTABLE code table — generic by design, with the
 *      MiniMax table shipped as a preset ({@link MINIMAX_ERROR_CODES}).
 *   3. The status/message heuristics of {@link classifyProviderError} as
 *      the fallback.
 *
 * The vendor trace-id header is captured into the verdict so the throw site
 * can attach it to a ProviderError (`requestId`, mirroring the LlmFailure
 * requestId shape in llm-error.ts).
 *
 * Transport failures are classified separately by walking the Node error's
 * `cause` chain for stable OS/library codes (cc-switch src-tauri/src/proxy/
 * error.rs:234-269 classify_error_chain borrowing): zh-CN Windows localizes
 * the `message` ("以一种访问权限不允许的方式…"), so message heuristics cannot
 * be trusted there while `ECONNREFUSED` / `ETIMEDOUT` / `CERT_*` stay stable.
 * The resulting {@link NetworkErrorKind} is merged into the verdict as a
 * diagnostic field next to `requestId`.
 */

import {
  isContextWindowExceededError,
  isQuotaExceededError,
  TRANSPORT_ERROR_CODE,
} from "./error-utils.js"

/**
 * Map an HTTP status to a stable error code string (借鉴 deepseek-harness).
 * Used to standardize error codes across different provider adapters.
 */
export function httpErrorCode(status: number): string {
  if (status === 401 || status === 403) return "AUTH"
  if (status === 429) return "RATE_LIMIT"
  if (status === 400) return "INVALID_REQUEST"
  if (status >= 500) return "SERVER"
  return `HTTP_${status}`
}

/**
 * Classify a provider error to determine retryability and error code.
 * Uses deepseek-harness error classification predicates.
 */
export function classifyProviderError(
  statusCode: number | undefined,
  message: string,
): { retryable: boolean; code: string } {
  if (statusCode === 401 || statusCode === 403) {
    return { retryable: false, code: "AUTH" }
  }
  if (statusCode === 429) {
    return { retryable: true, code: "RATE_LIMIT" }
  }
  if (statusCode !== undefined && statusCode >= 500) {
    return { retryable: true, code: "SERVER" }
  }
  if (statusCode === 0 || message.includes("fetch failed") || message.includes("ECONNREFUSED")) {
    return { retryable: true, code: "TRANSPORT" }
  }
  if (isContextWindowExceededError(message)) {
    return { retryable: false, code: "CONTEXT_WINDOW_EXCEEDED" }
  }
  if (isQuotaExceededError(message)) {
    return { retryable: false, code: "QUOTA" }
  }
  if (statusCode === undefined) {
    return { retryable: false, code: "UNKNOWN" }
  }
  return { retryable: false, code: httpErrorCode(statusCode) }
}

/** Stable classification for one vendor error code. */
export interface VendorErrorCodeEntry {
  /** Stable cross-provider code — "AUTH" | "CONTENT_FILTER" | "QUOTA" | ... */
  readonly code: string
  /** Whether a request that failed with this code may be retried as-is. */
  readonly retryable: boolean
}

/**
 * Vendor code table: vendor numeric code → stable classification.
 * Injectable so new vendors are a data change, not a classifier change.
 */
export type VendorErrorCodeTable = Readonly<Record<string, VendorErrorCodeEntry>>

/**
 * MiniMax vendor code preset (cli src/errors/api.ts mapApiErrorBase
 * borrowing). Codes read from `base_resp.status_code` or a trailing
 * "(NNNN)" message suffix:
 *   - 1004: auth failure (bad key / host) → AUTH
 *   - 1002/1026/1027/1039: input/output content sensitivity filter →
 *     CONTENT_FILTER (retrying verbatim will fail again)
 *   - 1028/1030: quota exhausted → QUOTA
 *   - 2061/2068: model not available on the current plan → QUOTA
 */
export const MINIMAX_ERROR_CODES: VendorErrorCodeTable = Object.freeze({
  1004: Object.freeze({ code: "AUTH", retryable: false }),
  1002: Object.freeze({ code: "CONTENT_FILTER", retryable: false }),
  1026: Object.freeze({ code: "CONTENT_FILTER", retryable: false }),
  1027: Object.freeze({ code: "CONTENT_FILTER", retryable: false }),
  1039: Object.freeze({ code: "CONTENT_FILTER", retryable: false }),
  1028: Object.freeze({ code: "QUOTA", retryable: false }),
  1030: Object.freeze({ code: "QUOTA", retryable: false }),
  2061: Object.freeze({ code: "QUOTA", retryable: false }),
  2068: Object.freeze({ code: "QUOTA", retryable: false }),
})

/** Full error facts a throw site can gather from an SDK/fetch error. */
export interface ProviderErrorFacts {
  /** HTTP status, when the transport surfaced one. */
  readonly status?: number
  /** Error message text (may carry a trailing vendor code). */
  readonly message?: string
  /**
   * Parsed JSON body (or a raw JSON string, parsed on demand). Read for
   * `base_resp.status_code` / `error.code` vendor codes.
   */
  readonly body?: unknown
  /** Response headers — Headers-like object or a plain record. */
  readonly headers?: unknown
  /** Injectable vendor code table; defaults to {@link MINIMAX_ERROR_CODES}. */
  readonly codeTable?: VendorErrorCodeTable
  /**
   * Stable transport kind derived from the Node `code` cause chain by
   * {@link classifyNetworkCauseChain}, when one matched. Precomputed by
   * {@link errorFactsFromUnknown}.
   */
  readonly networkKind?: NetworkErrorKind
}

/** Body-aware classification verdict. */
export interface ClassifiedProviderError {
  retryable: boolean
  code: string
  /** Vendor trace/request id from the response headers, when present. */
  requestId?: string
  /** Raw vendor code that drove the classification, when one matched. */
  vendorCode?: string
  /**
   * Stable transport kind (REFUSED / TIMEOUT / DNS / TLS / BLOCKED /
   * BROKEN_PIPE) when the failure came from the Node cause chain. Diagnostic
   * companion to {@link ProviderError.requestId}; `code` stays TRANSPORT.
   */
  networkKind?: NetworkErrorKind
}

/** Response headers searched for the vendor trace id (MiniMax uses `trace-id`). */
const TRACE_ID_HEADERS = ["trace-id", "x-trace-id", "x-request-id", "request-id"] as const

/**
 * Capture the vendor trace id from response headers (MiniMax-MCP-JS
 * api.ts "Trace ID: response.headers['trace-id']" borrowing). Accepts a
 * Headers-like object (has `.get`) or a plain record; record lookups are
 * case-insensitive.
 */
export function pickTraceId(headers: unknown): string | undefined {
  if (typeof headers !== "object" || headers === null) return undefined
  const record = headers as { get?: (name: string) => unknown }
  if (typeof record.get === "function") {
    for (const name of TRACE_ID_HEADERS) {
      const value = record.get(name)
      if (typeof value === "string" && value.trim() !== "") return value.trim()
    }
    return undefined
  }
  const lowered = new Map<string, unknown>()
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    lowered.set(key.toLowerCase(), value)
  }
  for (const name of TRACE_ID_HEADERS) {
    const value = lowered.get(name)
    if (typeof value === "string" && value.trim() !== "") return value.trim()
    if (Array.isArray(value) && typeof value[0] === "string" && value[0].trim() !== "") {
      return value[0].trim()
    }
  }
  return undefined
}

/**
 * Parse `body` when the caller only has the raw text. Non-JSON strings
 * yield undefined — message-suffix codes still apply via the message.
 */
function parseBody(body: unknown): Record<string, unknown> | undefined {
  if (typeof body === "string") {
    try {
      const parsed: unknown = JSON.parse(body)
      return typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : undefined
    } catch {
      return undefined
    }
  }
  if (typeof body === "object" && body !== null && !Array.isArray(body)) {
    return body as Record<string, unknown>
  }
  return undefined
}

/** Read a numeric vendor code out of an unknown value, or undefined. */
function asVendorCode(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  if (typeof value === "string" && /^\d{3,9}$/.test(value.trim())) return value.trim()
  return undefined
}

/** MiniMax-style base_resp block (MiniMax-MCP-JS api.ts borrowing). */
interface BaseRespWire {
  status_code?: unknown
  status_msg?: unknown
}

/**
 * Extract the vendor error code from the error body, falling back to a
 * trailing "(1027)"-style code at the end of the message (cli
 * mapApiErrorBase borrowing — the OpenAI-style image APIs put the MiniMax
 * code there because they cannot carry base_resp).
 *
 * `base_resp.status_code === 0` means success and is ignored.
 */
export function extractVendorErrorCode(body: unknown, message?: string): string | undefined {
  const parsed = parseBody(body)
  if (parsed) {
    const baseResp = parsed["base_resp"]
    if (typeof baseResp === "object" && baseResp !== null) {
      const statusCode = asVendorCode((baseResp as BaseRespWire).status_code)
      if (statusCode !== undefined && statusCode !== "0") return statusCode
    }
    const errorCode = asVendorCode(
      typeof parsed["error"] === "object" && parsed["error"] !== null
        ? (parsed["error"] as Record<string, unknown>)["code"]
        : undefined,
    )
    if (errorCode !== undefined) return errorCode
    const topLevelCode = asVendorCode(parsed["status_code"])
    if (topLevelCode !== undefined && topLevelCode !== "0") return topLevelCode
    // Body-carried messages can carry the trailing code even when the
    // caller's `message` does not (cli reads body.error.message).
    const bodyMessage = bodyErrorMessage(parsed)
    if (bodyMessage) {
      const match = /\((\d{3,9})\)\s*$/.exec(bodyMessage.trim())
      if (match) return match[1]
    }
  }
  // Trailing "(NNNN)" message suffix — e.g.
  // "no image generated: all 2 images failed content safety check (1027)".
  if (message) {
    const match = /\((\d{3,9})\)\s*$/.exec(message.trim())
    if (match) return match[1]
  }
  return undefined
}

/** The provider's own message inside a parsed body (`error.message` / `base_resp.status_msg`). */
function bodyErrorMessage(parsed: Record<string, unknown>): string | undefined {
  const error = parsed["error"]
  if (typeof error === "object" && error !== null) {
    const message = (error as Record<string, unknown>)["message"]
    if (typeof message === "string" && message.trim() !== "") return message
  }
  const baseResp = parsed["base_resp"]
  if (typeof baseResp === "object" && baseResp !== null) {
    const statusMsg = (baseResp as BaseRespWire).status_msg
    if (typeof statusMsg === "string" && statusMsg.trim() !== "") return statusMsg
  }
  return undefined
}

// ── Network cause-chain classification ─────────────────────────────────────

/**
 * Stable transport failure kinds (cc-switch src-tauri/src/proxy/error.rs:218-227
 * `NetworkErrorKind` borrowing, renamed to SCREAMING_SNAKE for this package).
 *
 * The kind is a diagnostic label; retryability is uniform (TRANSPORT is in
 * DEFAULT_RETRYABLE_CODES) because every one of these is a connection-level
 * failure that may succeed on a fresh attempt.
 */
export type NetworkErrorKind = "BLOCKED" | "REFUSED" | "BROKEN_PIPE" | "TIMEOUT" | "DNS" | "TLS"

/** Stable Node error codes mapped to kinds; TLS codes match the CERT marker. */
const NETWORK_CODE_KINDS: Readonly<Record<string, NetworkErrorKind>> = Object.freeze({
  EACCES: "BLOCKED",
  EPERM: "BLOCKED",
  ECONNREFUSED: "REFUSED",
  EPIPE: "BROKEN_PIPE",
  ENOTFOUND: "DNS",
  EAI_AGAIN: "DNS",
  ETIMEDOUT: "TIMEOUT",
})

/**
 * Node TLS certificate failure codes all carry `CERT` (`CERT_HAS_EXPIRED`,
 * `DEPTH_ZERO_SELF_SIGNED_CERT`, `SELF_SIGNED_CERT_IN_CHAIN`, …) — matching
 * by substring keeps the self-signed variants that lack the `CERT_` prefix.
 */
const CERT_CODE_MARKER = "CERT"

/** Defensive cap so a cyclic/very deep `cause` chain cannot spin. */
const MAX_CAUSE_DEPTH = 10

function networkKindForCode(code: string): NetworkErrorKind | undefined {
  if (code.includes(CERT_CODE_MARKER)) return "TLS"
  return Object.prototype.hasOwnProperty.call(NETWORK_CODE_KINDS, code)
    ? NETWORK_CODE_KINDS[code]
    : undefined
}

// DNS/TLS fallback wording is intentionally English-only (cc-switch borrowing):
// undici / rustls / c-ares emit English regardless of the OS locale, while the
// outer `TypeError: fetch failed` message is what gets localized.
const DNS_TEXT_PATTERN = /\b(?:dns|getaddrinfo|name resolution|nodename nor servname)\b/i
const TLS_TEXT_PATTERN = /\b(?:certificate|cert|tls|ssl|handshake)\b/i

/**
 * Walk an unknown thrown value's `cause` chain and classify the transport
 * failure (cc-switch error.rs:234-269 `classify_error_chain` borrowing).
 *
 * Stable Node codes win over text: `fetch failed` wraps the real
 * `ECONNREFUSED` / `ETIMEDOUT` / `CERT_*` one or two levels down, and on
 * localized Windows the wrapper message carries no usable signal. When no
 * code matches, DNS and TLS fall back to English text on the cause messages.
 *
 * @returns the stable kind, or undefined when nothing matched (the caller
 *          keeps its original status/message heuristics unchanged).
 */
export function classifyNetworkCauseChain(err: unknown): NetworkErrorKind | undefined {
  let dns = false
  let blocked = false
  let refused = false
  let brokenPipe = false
  let timeout = false
  let tls = false

  const seen = new Set<unknown>()
  let current: unknown = err
  for (
    let depth = 0;
    depth < MAX_CAUSE_DEPTH && current !== null && current !== undefined;
    depth++
  ) {
    if (seen.has(current)) break
    seen.add(current)
    if (typeof current === "object") {
      const code = (current as { code?: unknown }).code
      if (typeof code === "string") {
        const kind = networkKindForCode(code)
        if (kind === "DNS") dns = true
        else if (kind === "BLOCKED") blocked = true
        else if (kind === "REFUSED") refused = true
        else if (kind === "BROKEN_PIPE") brokenPipe = true
        else if (kind === "TIMEOUT") timeout = true
        else if (kind === "TLS") tls = true
      }
      const message = (current as { message?: unknown }).message
      if (typeof message === "string") {
        if (DNS_TEXT_PATTERN.test(message)) dns = true
        if (TLS_TEXT_PATTERN.test(message)) tls = true
      }
    }
    current = (current as { cause?: unknown }).cause
  }

  // Same precedence as cc-switch: DNS first, then local blocking, connection
  // refusal/breakage, timeout, TLS.
  if (dns) return "DNS"
  if (blocked) return "BLOCKED"
  if (refused) return "REFUSED"
  if (brokenPipe) return "BROKEN_PIPE"
  if (timeout) return "TIMEOUT"
  if (tls) return "TLS"
  return undefined
}

/**
 * Gather {@link ProviderErrorFacts} from an unknown thrown value — the SDK
 * error shapes (openai `APIError`, `@anthropic-ai/sdk` `APIError`) all
 * expose `status`, `message`, the parsed response body under `error` (or
 * `body`) and the response `headers`. Fetch errors carry none of those and
 * degrade to message-only facts.
 */
export function errorFactsFromUnknown(err: unknown): ProviderErrorFacts {
  // Transport kind first: the cause chain is locale-independent even when the
  // outer message is localized, and it must survive the SDK wrappers.
  const networkKind = classifyNetworkCauseChain(err)
  const source = err as
    | {
        status?: unknown
        message?: unknown
        error?: unknown
        body?: unknown
        headers?: unknown
      }
    | undefined
  if (source === null || typeof source !== "object") {
    return {
      message: typeof err === "string" ? err : undefined,
      ...(networkKind === undefined ? {} : { networkKind }),
    }
  }
  return {
    status: typeof source.status === "number" ? source.status : undefined,
    message: typeof source.message === "string" ? source.message : undefined,
    body: source.error ?? source.body,
    headers: source.headers,
    ...(networkKind === undefined ? {} : { networkKind }),
  }
}

/**
 * Body-aware provider error classification — the generic entry point the
 * format layers call in their catch blocks. Vendor codes outrank message
 * heuristics but HTTP status classification (401/403/429/402, cli order)
 * is applied first so transport-level semantics stay stable; on 2xx/absent
 * status the vendor code is the ONLY meaningful signal, exactly the
 * "HTTP 200 + status_code" case that motivated the module. A Node cause-chain
 * transport kind then outranks the message heuristics, and only when neither
 * body nor chain carries a signal do the original heuristics apply unchanged.
 */
export function classifyProviderErrorBody(facts: ProviderErrorFacts): ClassifiedProviderError {
  const { status, body, headers } = facts
  const codeTable = facts.codeTable ?? MINIMAX_ERROR_CODES
  const requestId = pickTraceId(headers)
  // The effective message for heuristics (cli mapApiErrorBase borrowing):
  // the throw-site message first, then the provider's own body message —
  // `base_resp.status_msg` / `error.message` carry the content-filter and
  // context-window wording the status alone cannot express.
  const apiMessage =
    [facts.message, bodyErrorMessage(parseBody(body) ?? {})].find(
      (candidate): candidate is string => typeof candidate === "string" && candidate.trim() !== "",
    ) ?? ""

  // 1. HTTP status precedence (cli mapApiErrorBase order).
  if (status === 401 || status === 403) {
    return { retryable: false, code: "AUTH", requestId }
  }
  if (status === 429) {
    return { retryable: true, code: "RATE_LIMIT", requestId }
  }
  if (status === 402) {
    return { retryable: false, code: "QUOTA", requestId }
  }

  // 2. Vendor code from the body / message suffix, via the injectable table.
  const vendorCode = extractVendorErrorCode(body, apiMessage)
  if (vendorCode !== undefined) {
    const entry = codeTable[vendorCode]
    if (entry) {
      return { retryable: entry.retryable, code: entry.code, requestId, vendorCode }
    }
  }

  // 3. Stable transport kind from the Node cause chain (cc-switch
  // classify_error_chain borrowing). This outranks the message heuristics:
  // `code` is locale-independent while the message may be localized, and it
  // keeps working when "fetch failed" is wrapped two levels deep.
  if (facts.networkKind !== undefined) {
    return {
      retryable: true,
      code: TRANSPORT_ERROR_CODE,
      requestId,
      vendorCode,
      networkKind: facts.networkKind,
    }
  }

  // 4. Status/message heuristics as the fallback.
  const fallback = classifyProviderError(status, apiMessage)
  return { retryable: fallback.retryable, code: fallback.code, requestId, vendorCode }
}
