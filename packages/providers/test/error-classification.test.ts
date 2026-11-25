// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Body-aware provider error classification + trace-id capture
 * (MiniMax-MCP-JS src/utils/api.ts:92-107 + cli src/errors/api.ts:52-179
 * mapApiErrorBase borrowing).
 *
 * Contracts under test:
 *   - vendor codes from `base_resp.status_code` / `error.code` / trailing
 *     "(NNNN)" message suffix map through the (injectable) code table to
 *     stable classifications — including the HTTP 200 + status_code case
 *     the status-only classifier cannot see;
 *   - the vendor trace-id response header lands in the verdict and on the
 *     thrown ProviderError.requestId (LlmFailure.requestId shape);
 *   - the openai-chat catch blocks wire the verdict (code/requestId/
 *     retryable) into ProviderError;
 *   - withRetry honors the explicit verdict: classified non-retryable
 *     errors are not retried even when the HTTP status looks transient.
 */
import { describe, expect, it } from "vitest"
import {
  classifyProviderErrorBody,
  classifyNetworkCauseChain,
  extractVendorErrorCode,
  pickTraceId,
  errorFactsFromUnknown,
  MINIMAX_ERROR_CODES,
  type NetworkErrorKind,
} from "../src/error-classification.js"
import { ProviderError } from "../src/base.js"
import { withRetry } from "../src/retry.js"
import { OpenAIChatProvider } from "../src/formats/openai-chat.js"
import type { ChatMessage } from "../src/base.js"

/** Node-style error carrying a stable OS/library `code` (cc-switch borrowing). */
function codedError(code: string, message = "connect failed"): Error {
  return Object.assign(new Error(message), { code })
}

describe("classifyProviderErrorBody — MiniMax preset codes", () => {
  it("maps base_resp.status_code 1004 to AUTH (non-retryable)", () => {
    const verdict = classifyProviderErrorBody({
      status: 200,
      body: { base_resp: { status_code: 1004, status_msg: "invalid api key" } },
    })
    expect(verdict.code).toBe("AUTH")
    expect(verdict.retryable).toBe(false)
    expect(verdict.vendorCode).toBe("1004")
  })

  it("maps HTTP 200 + status_code 1028 to QUOTA — the case status-only classification misses", () => {
    const verdict = classifyProviderErrorBody({
      status: 200,
      body: { base_resp: { status_code: 1028, status_msg: "quota exceeded" } },
    })
    expect(verdict.code).toBe("QUOTA")
    expect(verdict.retryable).toBe(false)
  })

  it("maps content-filter codes 1026/1027/1039 to CONTENT_FILTER (non-retryable)", () => {
    for (const code of [1026, 1027, 1039]) {
      const verdict = classifyProviderErrorBody({
        body: { base_resp: { status_code: code } },
      })
      expect(verdict.code, String(code)).toBe("CONTENT_FILTER")
      expect(verdict.retryable, String(code)).toBe(false)
    }
  })

  it("maps quota codes 1028/1030/2061/2068 to QUOTA (non-retryable)", () => {
    for (const code of [1028, 1030, 2061, 2068]) {
      const verdict = classifyProviderErrorBody({
        body: { base_resp: { status_code: code } },
      })
      expect(verdict.code, String(code)).toBe("QUOTA")
      expect(verdict.retryable, String(code)).toBe(false)
    }
  })

  it("reads a trailing '(1027)' message code (OpenAI-style image API shape)", () => {
    const verdict = classifyProviderErrorBody({
      status: 200,
      message: "no image generated: all 2 images failed content safety check (1027)",
    })
    expect(verdict.code).toBe("CONTENT_FILTER")
    expect(verdict.retryable).toBe(false)
    expect(verdict.vendorCode).toBe("1027")
  })

  it("ignores base_resp.status_code 0 (success) and unknown codes", () => {
    const zero = classifyProviderErrorBody({
      body: { base_resp: { status_code: 0 } },
    })
    expect(zero.vendorCode).toBeUndefined()
    expect(zero.code).toBe("UNKNOWN")
    const unknownCode = classifyProviderErrorBody({
      status: 400,
      body: { base_resp: { status_code: 9999 } },
    })
    // Not in any table → falls back to the status heuristic.
    expect(unknownCode.code).toBe("INVALID_REQUEST")
    expect(unknownCode.retryable).toBe(false)
  })

  it("keeps HTTP status precedence (cli order): 401 beats the vendor code", () => {
    const verdict = classifyProviderErrorBody({
      status: 401,
      body: { base_resp: { status_code: 1004 } },
    })
    expect(verdict.code).toBe("AUTH")
    expect(verdict.retryable).toBe(false)
  })

  it("classifies 429 as retryable RATE_LIMIT and 402 as QUOTA", () => {
    const rate = classifyProviderErrorBody({ status: 429, headers: { "trace-id": "t-1" } })
    expect(rate.code).toBe("RATE_LIMIT")
    expect(rate.retryable).toBe(true)
    expect(rate.requestId).toBe("t-1")
    const balance = classifyProviderErrorBody({ status: 402 })
    expect(balance.code).toBe("QUOTA")
    expect(balance.retryable).toBe(false)
  })

  it("supports an injectable code table (generic, not MiniMax-hardcoded)", () => {
    const verdict = classifyProviderErrorBody({
      status: 200,
      body: { base_resp: { status_code: 9001 } },
      codeTable: { 9001: { code: "CONCURRENCY", retryable: true } },
    })
    expect(verdict.code).toBe("CONCURRENCY")
    expect(verdict.retryable).toBe(true)
  })

  it("falls back to message heuristics when the body carries no table code", () => {
    const verdict = classifyProviderErrorBody({
      status: 400,
      body: { error: { message: "This model's maximum context length is 8192 tokens" } },
    })
    expect(verdict.code).toBe("CONTEXT_WINDOW_EXCEEDED")
    expect(verdict.retryable).toBe(false)
  })

  it("exposes the MiniMax table as a preset and accepts it explicitly", () => {
    expect(MINIMAX_ERROR_CODES["1004"]).toEqual({ code: "AUTH", retryable: false })
    const verdict = classifyProviderErrorBody({
      body: { base_resp: { status_code: 1004 } },
      codeTable: MINIMAX_ERROR_CODES,
    })
    expect(verdict.code).toBe("AUTH")
  })
})

describe("extractVendorErrorCode / pickTraceId", () => {
  it("prefers base_resp over error.code over trailing message suffix", () => {
    expect(extractVendorErrorCode({ base_resp: { status_code: 1004 } })).toBe("1004")
    expect(extractVendorErrorCode({ error: { code: 1039 } })).toBe("1039")
    expect(extractVendorErrorCode({ error: { code: "not_numeric" } }, "boom (1027)")).toBe("1027")
    expect(extractVendorErrorCode(undefined, "boom (1027)")).toBe("1027")
    expect(extractVendorErrorCode({ base_resp: { status_code: 0 } })).toBeUndefined()
  })

  it("parses a raw JSON string body", () => {
    expect(extractVendorErrorCode('{"base_resp":{"status_code":1028}}')).toBe("1028")
    expect(extractVendorErrorCode("not json", "boom (1030)")).toBe("1030")
  })

  it("reads trace-id from Headers-like objects and plain records", () => {
    const headersLike = {
      get: (name: string) => (name === "trace-id" ? "tr-abc" : null),
    }
    expect(pickTraceId(headersLike)).toBe("tr-abc")
    expect(pickTraceId({ "X-Request-Id": "req-1" })).toBe("req-1")
    expect(pickTraceId({ "trace-id": ["first", "second"] })).toBe("first")
    expect(pickTraceId({ unrelated: "x" })).toBeUndefined()
    expect(pickTraceId(null)).toBeUndefined()
  })
})

describe("openai-chat catch wiring — code / retryable / requestId on ProviderError", () => {
  const messages: ChatMessage[] = [{ role: "user", content: "hi" }]
  const provider = () =>
    new OpenAIChatProvider({
      id: "t",
      name: "t",
      apiKey: "k",
      baseURL: "https://example.com/v1",
      defaultModel: "m",
    })

  /** Swap the private SDK client for one whose chat call throws `err`. */
  function injectThrowingClient(p: OpenAIChatProvider, err: unknown): void {
    ;(p as unknown as { client: unknown }).client = {
      chat: {
        completions: {
          create: async () => {
            throw err
          },
        },
      },
    }
  }

  it("HTTP 200 + base_resp 1028 lands as QUOTA with the trace id captured", async () => {
    const p = provider()
    injectThrowingClient(
      p,
      Object.assign(new Error("quota exceeded (1028)"), {
        status: 200,
        error: { base_resp: { status_code: 1028, status_msg: "quota exceeded" } },
        headers: { "trace-id": "tr-1028" },
      }),
    )
    await expect(p.chat(messages)).rejects.toMatchObject({
      name: "ProviderError",
      statusCode: 200,
      code: "QUOTA",
      requestId: "tr-1028",
      retryable: false,
    })
  })

  it("message-suffix (1027) with a Headers-like trace id lands as CONTENT_FILTER", async () => {
    const p = provider()
    injectThrowingClient(
      p,
      Object.assign(new Error("output blocked: content safety check (1027)"), {
        status: 200,
        headers: { get: (name: string) => (name === "x-trace-id" ? "tr-77" : null) },
      }),
    )
    await expect(p.stream(messages).next()).rejects.toMatchObject({
      code: "CONTENT_FILTER",
      requestId: "tr-77",
      retryable: false,
    })
  })

  it("a plain transport error still classifies via the status/message fallback", async () => {
    const p = provider()
    injectThrowingClient(p, new Error("fetch failed"))
    await expect(p.chat(messages)).rejects.toMatchObject({
      code: "TRANSPORT",
      retryable: true,
    })
  })

  it("passes an already-classified ProviderError through the chat() catch unchanged", async () => {
    // The stream() catch has always had this guard; chat() must not
    // re-wrap. Re-wrapping would read `.status`/`.body` (ProviderError has
    // `.statusCode`) and erase the explicit verdict below.
    const p = provider()
    injectThrowingClient(
      p,
      new ProviderError(
        "t",
        429,
        "rate limited upstream",
        undefined,
        "RATE_LIMIT",
        "tr-passthru",
        true,
      ),
    )
    await expect(p.chat(messages)).rejects.toMatchObject({
      providerId: "t",
      statusCode: 429,
      code: "RATE_LIMIT",
      requestId: "tr-passthru",
      retryable: true,
    })
  })

  it("ProviderError.requestId mirrors the LlmFailure.requestId shape", () => {
    const err = new ProviderError("t", 429, "rate limited", undefined, "RATE_LIMIT", "tr-9", true)
    expect(err.requestId).toBe("tr-9")
    expect(err.retryable).toBe(true)
    expect(err.message).toBe("[t] rate limited")
    const bare = new ProviderError("t", 400, "bad request")
    expect(bare.requestId).toBeUndefined()
    expect(bare.retryable).toBeUndefined()
  })

  it("classifies a localized transport error by its stable cause-chain code", async () => {
    const p = provider()
    injectThrowingClient(
      p,
      Object.assign(new Error("以一种访问权限不允许的方式，做了一个访问套接字尝试。"), {
        status: undefined,
        cause: codedError("ECONNREFUSED"),
      }),
    )
    await expect(p.chat(messages)).rejects.toMatchObject({
      code: "TRANSPORT",
      retryable: true,
      networkKind: "REFUSED",
    })
  })
})

describe("withRetry honors the explicit body-aware verdict", () => {
  const messages: ChatMessage[] = [{ role: "user", content: "hi" }]

  it("does NOT retry a ProviderError classified non-retryable (status looks transient)", async () => {
    let attempts = 0
    const provider = {
      id: "t",
      name: "t",
      defaultModel: "m",
      isConfigured: () => true,
      chat: async () => {
        attempts += 1
        throw new ProviderError(
          "t",
          500,
          "vendor says stop",
          undefined,
          "CONTENT_FILTER",
          undefined,
          false,
        )
      },
      stream: async function* () {
        yield { delta: "", done: true }
      },
    }
    const resilient = withRetry(provider, { maxAttempts: 3, baseDelay: 1, sleep: async () => {} })
    await expect(resilient.chat(messages)).rejects.toBeInstanceOf(ProviderError)
    expect(attempts).toBe(1)
  })

  it("DOES retry a ProviderError explicitly marked retryable (status looks final)", async () => {
    let attempts = 0
    const provider = {
      id: "t",
      name: "t",
      defaultModel: "m",
      isConfigured: () => true,
      chat: async () => {
        attempts += 1
        if (attempts === 1) {
          throw new ProviderError(
            "t",
            400,
            "vendor says transient",
            undefined,
            "CONCURRENCY",
            undefined,
            true,
          )
        }
        return { content: "ok", model: "m" }
      },
      stream: async function* () {
        yield { delta: "", done: true }
      },
    }
    const resilient = withRetry(provider, { maxAttempts: 3, baseDelay: 1, sleep: async () => {} })
    const res = await resilient.chat(messages)
    expect(res.content).toBe("ok")
    expect(attempts).toBe(2)
  })

  it("unclassified ProviderErrors keep the heuristic behavior", async () => {
    let attempts = 0
    const provider = {
      id: "t",
      name: "t",
      defaultModel: "m",
      isConfigured: () => true,
      chat: async () => {
        attempts += 1
        // 500 without an explicit verdict → heuristic retries.
        throw Object.assign(new Error("server error"), { statusCode: 500 })
      },
      stream: async function* () {
        yield { delta: "", done: true }
      },
    }
    const resilient = withRetry(provider, { maxAttempts: 3, baseDelay: 1, sleep: async () => {} })
    await expect(resilient.chat(messages)).rejects.toBeInstanceOf(Error)
    expect(attempts).toBe(3)
  })
})

describe("errorFactsFromUnknown", () => {
  it("reads SDK-shaped errors and degrades to message-only facts", () => {
    const sdkError = Object.assign(new Error("boom"), {
      status: 429,
      error: { base_resp: { status_code: 1002 } },
      headers: { "trace-id": "tr-1" },
    })
    expect(errorFactsFromUnknown(sdkError)).toEqual({
      status: 429,
      message: "boom",
      body: { base_resp: { status_code: 1002 } },
      headers: { "trace-id": "tr-1" },
    })
    expect(errorFactsFromUnknown("plain string")).toEqual({ message: "plain string" })
    expect(errorFactsFromUnknown(undefined)).toEqual({ message: undefined })
  })

  it("extracts the stable kind from the cause chain into the facts", () => {
    const sdkError = Object.assign(new Error("fetch failed"), { cause: codedError("EPIPE") })
    expect(errorFactsFromUnknown(sdkError).networkKind).toBe("BROKEN_PIPE")
    // No code anywhere → the field is absent so the original heuristics apply.
    expect(errorFactsFromUnknown(new Error("读取超时，请稍后再试")).networkKind).toBeUndefined()
  })
})

describe("classifyNetworkCauseChain — stable Node codes over localized text", () => {
  const cases: ReadonlyArray<readonly [string, NetworkErrorKind]> = [
    ["EACCES", "BLOCKED"],
    ["EPERM", "BLOCKED"],
    ["ECONNREFUSED", "REFUSED"],
    ["EPIPE", "BROKEN_PIPE"],
    ["ENOTFOUND", "DNS"],
    ["EAI_AGAIN", "DNS"],
    ["ETIMEDOUT", "TIMEOUT"],
    ["CERT_HAS_EXPIRED", "TLS"],
    ["DEPTH_ZERO_SELF_SIGNED_CERT", "TLS"],
  ]

  for (const [code, kind] of cases) {
    it(`maps ${code} to ${kind}`, () => {
      expect(classifyNetworkCauseChain({ code }), code).toBe(kind)
    })
  }

  it("walks two levels down the cause chain", () => {
    const inner = codedError("EPIPE")
    const mid = Object.assign(new Error("以一种访问权限不允许的方式，做了一个访问套接字尝试。"), {
      cause: inner,
    })
    const outer = Object.assign(new Error("fetch failed"), { cause: mid })
    expect(classifyNetworkCauseChain(outer)).toBe("BROKEN_PIPE")
  })

  it("ignores localized messages when a stable code is present", () => {
    for (const message of [
      "connect ECONNREFUSED 127.0.0.1:443",
      "以一种访问权限不允许的方式，做了一个访问套接字尝试。",
    ]) {
      expect(classifyNetworkCauseChain(codedError("ECONNREFUSED", message))).toBe("REFUSED")
    }
  })

  it("falls back to English DNS/TLS wording only when no code matches", () => {
    expect(classifyNetworkCauseChain(new Error("getaddrinfo ENOTFOUND api.example.com"))).toBe(
      "DNS",
    )
    expect(classifyNetworkCauseChain(new Error("certificate has expired"))).toBe("TLS")
    expect(classifyNetworkCauseChain(new Error("无法连接到网络，请检查设置"))).toBeUndefined()
  })

  it("merges the kind into the body verdict as retryable TRANSPORT", () => {
    const facts = errorFactsFromUnknown(
      Object.assign(new Error("以一种访问权限不允许的方式，做了一个访问套接字尝试。"), {
        cause: codedError("ETIMEDOUT"),
      }),
    )
    expect(facts.networkKind).toBe("TIMEOUT")
    expect(classifyProviderErrorBody(facts)).toMatchObject({
      code: "TRANSPORT",
      retryable: true,
      networkKind: "TIMEOUT",
    })
  })

  it("keeps the original heuristics unchanged when no code exists", () => {
    expect(
      classifyProviderErrorBody(errorFactsFromUnknown(new Error("fetch failed"))),
    ).toMatchObject({
      code: "TRANSPORT",
      retryable: true,
    })
    const localized = classifyProviderErrorBody(
      errorFactsFromUnknown(new Error("网络连接失败，请稍后再试")),
    )
    expect(localized.code).toBe("UNKNOWN")
    expect(localized.retryable).toBe(false)
    expect(localized.networkKind).toBeUndefined()
  })
})

describe("withRetry — cause-chain transport kind", () => {
  const messages: ChatMessage[] = [{ role: "user", content: "hi" }]

  it("retries a localized transport error via its stable cause code", async () => {
    let attempts = 0
    const provider = {
      id: "t",
      name: "t",
      defaultModel: "m",
      isConfigured: () => true,
      chat: async () => {
        attempts += 1
        if (attempts === 1) {
          throw Object.assign(new Error("以一种访问权限不允许的方式，做了一个访问套接字尝试。"), {
            cause: codedError("ETIMEDOUT"),
          })
        }
        return { content: "ok", model: "m" }
      },
      stream: async function* () {
        yield { delta: "", done: true }
      },
    }
    const resilient = withRetry(provider, { maxAttempts: 2, baseDelay: 1, sleep: async () => {} })
    await expect(resilient.chat(messages)).resolves.toMatchObject({ content: "ok" })
    expect(attempts).toBe(2)
  })
})
