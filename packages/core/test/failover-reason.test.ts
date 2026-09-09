/**
 * FailoverReason + classifyTaskError (借鉴 hermes-agent error_classifier.py).
 *
 * Tests the priority-ordered classification pipeline that maps error
 * messages to structured ClassifiedError with recovery hints.
 *
 * Verifies:
 *   - Auth permanent → not retryable, should rotate credential
 *   - Auth transient → retryable
 *   - Billing → not retryable
 *   - Context overflow → retryable, should compress
 *   - Rate limit → retryable
 *   - Overloaded → retryable, should fallback
 *   - Timeout → retryable
 *   - Server error → retryable, should fallback
 *   - Model not found → not retryable, should fallback
 *   - Unknown → retryable by default
 *   - Tool error → not retryable
 *   - Priority: permanent auth overrides generic auth
 */
import { describe, it, expect } from "vitest"
import { classifyTaskError, FailoverReason } from "../src/failover-reason.js"

describe("FailoverReason classifier (借鉴 hermes-agent)", () => {
  it("classifies auth_permanent as not retryable", () => {
    const result = classifyTaskError(new Error("API key revoked"))
    expect(result.reason).toBe("auth_permanent")
    expect(result.retryable).toBe(false)
    expect(result.shouldRotateCredential).toBe(true)
  })

  it("classifies auth as retryable with credential rotation", () => {
    const result = classifyTaskError(new Error("Authentication failed: invalid API key"))
    expect(result.reason).toBe("auth")
    expect(result.retryable).toBe(true)
    expect(result.shouldRotateCredential).toBe(true)
  })

  it("classifies billing as not retryable", () => {
    const result = classifyTaskError("402 payment required")
    expect(result.reason).toBe("billing")
    expect(result.retryable).toBe(false)
  })

  it("classifies context_overflow as retryable with compress hint", () => {
    const result = classifyTaskError("context_length_exceeded: maximum context length is 8192")
    expect(result.reason).toBe("context_overflow")
    expect(result.retryable).toBe(true)
    expect(result.shouldCompress).toBe(true)
  })

  it("classifies rate_limit as retryable", () => {
    const result = classifyTaskError("Rate limit exceeded")
    expect(result.reason).toBe("rate_limit")
    expect(result.retryable).toBe(true)
  })

  it("classifies overloaded as retryable with fallback hint", () => {
    const result = classifyTaskError("server is overloaded, try again later")
    expect(result.reason).toBe("overloaded")
    expect(result.retryable).toBe(true)
    expect(result.shouldFallback).toBe(true)
  })

  it("classifies timeout as retryable", () => {
    const result = classifyTaskError("Gateway timeout")
    expect(result.reason).toBe("timeout")
    expect(result.retryable).toBe(true)
  })

  it("classifies server_error as retryable with fallback hint", () => {
    const result = classifyTaskError("500 Internal Server Error")
    expect(result.reason).toBe("server_error")
    expect(result.retryable).toBe(true)
    expect(result.shouldFallback).toBe(true)
  })

  it("classifies model_not_found as not retryable with fallback hint", () => {
    const result = classifyTaskError("Model not found: gpt-4-xyz")
    expect(result.reason).toBe("model_not_found")
    expect(result.retryable).toBe(false)
    expect(result.shouldFallback).toBe(true)
  })

  it("classifies tool_error as not retryable", () => {
    const result = classifyTaskError("ToolError: file not found")
    expect(result.reason).toBe("tool_error")
    expect(result.retryable).toBe(false)
  })

  it("classifies unknown errors as retryable by default", () => {
    const result = classifyTaskError("Something completely unexpected happened")
    expect(result.reason).toBe("unknown")
    expect(result.retryable).toBe(true)
  })

  it("auth_permanent takes priority over generic auth patterns", () => {
    const result = classifyTaskError("credential revoked: invalid API key")
    expect(result.reason).toBe("auth_permanent")
    expect(result.retryable).toBe(false)
  })

  it("handles non-Error inputs", () => {
    const result = classifyTaskError("plain string error")
    expect(result.reason).toBe("unknown")
    expect(result.retryable).toBe(true)
  })

  it("classifies 403 as auth", () => {
    const result = classifyTaskError("403 Forbidden")
    expect(result.reason).toBe("auth")
    expect(result.retryable).toBe(true)
  })

  it("classifies 429 as rate_limit", () => {
    const result = classifyTaskError("429 Too Many Requests")
    expect(result.reason).toBe("rate_limit")
    expect(result.retryable).toBe(true)
  })
})