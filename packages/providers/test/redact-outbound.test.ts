// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Outbound error redaction (minimax-code 9a93560 borrowing — upstream
 * implementation in local-runtime-v2 test-connection.ts
 * `redactConnectionTestError`).
 *
 * Contracts under test:
 *   - caller secrets are replaced with `***`, LONGEST FIRST, so two secrets
 *     where one is a prefix of the other leave no residue of the longer one;
 *   - the generic regex groups (sk- keys / Bearer tokens / api-key|Authorization
 *     header values) scrub credentials the caller did not list;
 *   - whitespace is folded and the output is truncated to a sane bound;
 *   - no secret — listed or pattern-matched — survives in the output.
 */
import { describe, expect, it } from "vitest"
import { redactOutboundError } from "../src/redact.js"

describe("redactOutboundError — caller secrets", () => {
  it("replaces a listed API key with *** and leaks nothing", () => {
    const key = "sk-live-9f8e7d6c5b4a3210fedcba"
    const out = redactOutboundError(
      `401 Unauthorized from https://api.example.com — key ${key} rejected`,
      [key],
    )
    expect(out).toContain("***")
    expect(out).not.toContain(key)
    expect(out).not.toContain("9f8e7d6c5b4a3210")
  })

  it("replaces a Bearer header value from the secrets list", () => {
    const token = "eyJhbGciOiJIUzI1NiJ9.e30.abc123def456ghi789"
    const out = redactOutboundError(`401 Unauthorized: Authorization: Bearer ${token} expired`, [
      token,
    ])
    expect(out).not.toContain(token)
    expect(out).toContain("Bearer ***")
  })

  it("prefix-related secrets leave NO residue (longest-first ordering)", () => {
    // "abc123def" is a prefix of "abc123def456". Replacing the SHORTER one
    // first would leave "***456" — a partial residue of the longer secret.
    const longSecret = "abc123def456"
    const shortSecret = "abc123def"
    const out = redactOutboundError(
      `auth failed for keys ${longSecret} and ${shortSecret}`,
      [shortSecret, longSecret], // deliberately unsorted input
    )
    expect(out).not.toContain(longSecret)
    expect(out).not.toContain(shortSecret)
    expect(out).not.toContain("456")
    expect(out).not.toContain("abc123")
    expect(out).toBe("auth failed for keys *** and ***")
  })

  it("ignores secrets shorter than 4 characters (blind-replacing them corrupts text)", () => {
    const out = redactOutboundError("HTTP 401: bad key ab here", ["ab"])
    expect(out).toBe("HTTP 401: bad key ab here")
  })

  it("handles regex metacharacters in secrets (split/join, not RegExp)", () => {
    const secret = "k*(y)[1]"
    const out = redactOutboundError(`invalid key ${secret} for provider`, [secret])
    expect(out).not.toContain(secret)
    expect(out).toContain("***")
  })
})

describe("redactOutboundError — generic credential patterns", () => {
  it("blinds an sk- key the caller never listed", () => {
    const out = redactOutboundError("401: invalid key sk-proj-abcdefgh12345678", [])
    expect(out).toBe("401: invalid key sk-***")
  })

  it("blinds bare Bearer tokens and Authorization header values", () => {
    const bare = redactOutboundError("error: Bearer abcdefghijklmnopqrstuvwxyz123456 denied", [])
    expect(bare).toBe("error: Bearer *** denied")
    const header = redactOutboundError(
      "401 — authorization: Bearer zzzz-9999-8888-7777 rejected",
      [],
    )
    expect(header).toBe("401 — authorization: Bearer *** rejected")
  })

  it("blinds api-key / x-api-key header values", () => {
    expect(redactOutboundError("bad api_key: yyy123zzz456 (401)", [])).toBe(
      "bad api_key: *** (401)",
    )
    expect(redactOutboundError("bad x-api-key: yyy123zzz456 (401)", [])).toBe(
      "bad x-api-key: *** (401)",
    )
  })

  it("leaves ordinary error text untouched", () => {
    const text = "HTTP 500: internal provider error while routing model claude-x"
    expect(redactOutboundError(text, [])).toBe(text)
  })
})

describe("redactOutboundError — normalization", () => {
  it("folds whitespace before scrubbing", () => {
    const out = redactOutboundError(
      "401 Unauthorized:\n\n  key\n  sk-abcdefgh12345678  rejected",
      [],
    )
    expect(out).toBe("401 Unauthorized: key sk-*** rejected")
  })

  it("truncates to the upstream bound (1200 chars)", () => {
    const out = redactOutboundError("x".repeat(5000), [])
    expect(out.length).toBe(1200)
  })

  it("applies the generic patterns even with an empty secrets list", () => {
    const out = redactOutboundError("key sk-ant-abcdefghij1234567890 invalid", [])
    expect(out).not.toContain("abcdefghij")
    expect(out).toContain("sk-***")
  })
})
