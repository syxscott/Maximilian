// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Tests for the execution-error taxonomy (swarms borrowing): closed
 * category set, classifyError priority, and the crash-recovery decision
 * table. The classifier is pure — no I/O, fully deterministic.
 */
import { describe, expect, it } from "vitest"
import {
  classifyError,
  ERROR_CATEGORIES,
  ERROR_RESET_ACTIONS,
  type ErrorCategory,
} from "../src/error-taxonomy.js"
import { PolicyDeniedError } from "../src/policy-error.js"

describe("taxonomy shape", () => {
  it("is a closed six-category set", () => {
    expect(ERROR_CATEGORIES).toEqual([
      "transient",
      "permanent",
      "context_limit",
      "rate_limit",
      "cancelled",
      "unknown",
    ])
  })

  it("gives every category a reset action (no holes in the decision table)", () => {
    for (const category of ERROR_CATEGORIES) {
      expect(ERROR_RESET_ACTIONS[category]).toBeDefined()
    }
  })

  it("maps reset actions per policy: only transient-ish categories reset", () => {
    expect(ERROR_RESET_ACTIONS.transient).toBe("reset_retryable")
    expect(ERROR_RESET_ACTIONS.rate_limit).toBe("reset_retryable")
    expect(ERROR_RESET_ACTIONS.permanent).toBe("hold")
    expect(ERROR_RESET_ACTIONS.context_limit).toBe("hold")
    expect(ERROR_RESET_ACTIONS.cancelled).toBe("hold")
    expect(ERROR_RESET_ACTIONS.unknown).toBe("hold_and_count")
  })
})

describe("classifyError: cancellation probe runs first", () => {
  it("classifies AbortError as cancelled regardless of message content", () => {
    const err = new Error("rate limit exceeded")
    err.name = "AbortError"
    const c = classifyError(err)
    expect(c.category).toBe("cancelled")
    expect(c.resetAction).toBe("hold")
    expect(c.retryable).toBe(false)
  })

  it("classifies cancellation wording as cancelled", () => {
    expect(classifyError(new Error("task cancelled by user")).category).toBe("cancelled")
    expect(classifyError(new Error("run aborted before completion")).category).toBe("cancelled")
    expect(classifyError("canceled").category).toBe("cancelled")
  })

  it("does not misread 'cancelled' occurrences that are not the whole signal — but stays conservative", () => {
    // A rate-limit error that merely mentions cancellation is still
    // cancelled: the cancellation probe is intentionally first (control
    // flow beats failure shape).
    const c = classifyError(new Error("cancelled while waiting for retry backoff"))
    expect(c.category).toBe("cancelled")
  })
})

describe("classifyError: transport probe (swarms _NETWORK_ERRORS)", () => {
  it.each([
    "connect ECONNREFUSED 127.0.0.1:6379",
    "read ECONNRESET",
    "request to http://x failed, reason: getaddrinfo ENOTFOUND api.example.com",
    "ETIMEDOUT",
    "write EPIPE",
    "socket hang up",
    "fetch failed",
  ])("classifies %j as transient", (message) => {
    const c = classifyError(new Error(message))
    expect(c.category).toBe("transient")
    expect(c.retryable).toBe(true)
    expect(c.resetAction).toBe("reset_retryable")
  })
})

describe("classifyError: message patterns fold into the closed set", () => {
  it("rate limiting", () => {
    const c = classifyError(new Error("429 Too Many Requests: rate limit exceeded"))
    expect(c.category).toBe("rate_limit")
    expect(c.retryable).toBe(true)
    expect(c.resetAction).toBe("reset_retryable")
  })

  it("context overflow", () => {
    const c = classifyError(new Error("maximum context length exceeded"))
    expect(c.category).toBe("context_limit")
    // A blind re-run without compaction re-hits the same wall: not
    // retryable as-is, but not a terminal verdict either.
    expect(c.retryable).toBe(false)
    expect(c.resetAction).toBe("hold")
  })

  it.each([
    ["api key revoked by provider", "permanent"],
    ["insufficient quota: billing required", "permanent"],
    ["Permission denied: bash -> /etc/shadow", "permanent"],
    ["model not found: gpt-9", "permanent"],
  ] as Array<[string, ErrorCategory]>)("%s → %s", (message, expected) => {
    const c = classifyError(new Error(message))
    expect(c.category).toBe(expected)
    expect(c.resetAction).toBe("hold")
    expect(c.retryable).toBe(false)
  })

  it("recoverable auth failures are transient (rotate credential + retry)", () => {
    const c = classifyError(new Error("invalid api key supplied"))
    expect(c.category).toBe("transient")
    expect(c.resetAction).toBe("reset_retryable")
  })

  it("timeouts and server errors are transient", () => {
    expect(classifyError(new Error("request timed out after 30s")).category).toBe("transient")
    expect(classifyError(new Error("503 service unavailable")).category).toBe("transient")
  })

  it("policy denials are permanent (deny ≠ failure, but never auto-reset)", () => {
    const c = classifyError(new PolicyDeniedError("bash", "rm -rf /"))
    expect(c.category).toBe("permanent")
    expect(c.resetAction).toBe("hold")
  })
})

describe("classifyError: unknown is conservative", () => {
  it("falls back to unknown with hold_and_count (never auto-reset)", () => {
    const c = classifyError(new Error("something deeply unexpected happened"))
    expect(c.category).toBe("unknown")
    expect(c.retryable).toBe(false)
    expect(c.resetAction).toBe("hold_and_count")
  })

  it("handles non-Error throwables without throwing", () => {
    expect(classifyError(undefined).category).toBe("unknown")
    expect(classifyError(42).message).toBe("42")
    expect(classifyError({ weird: true }).category).toBe("unknown")
  })

  it("bounds the message at 500 chars", () => {
    const c = classifyError(new Error("x".repeat(10_000)))
    expect(c.message.length).toBe(500)
  })
})
