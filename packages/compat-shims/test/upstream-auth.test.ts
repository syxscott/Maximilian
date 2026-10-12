// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Upstream auth selection tests (cc-switch `6e7811e5` borrowing):
 * the auth header is chosen by the UPSTREAM PROTOCOL, not by the env
 * variable name the credential came from. OpenAI Chat / Responses
 * upstreams always get `Authorization: Bearer` (x-api-key is rejected
 * there); Anthropic Messages upstreams keep the env-var semantics
 * (ANTHROPIC_API_KEY → x-api-key, ANTHROPIC_AUTH_TOKEN → Bearer).
 */

import { describe, it, expect } from "vitest"
import { upstreamAuthHeaders } from "../src/llm.js"

describe("upstreamAuthHeaders", () => {
  it("sends Bearer to OpenAI-format upstreams even for ANTHROPIC_API_KEY credentials", () => {
    for (const protocol of ["openai_chat", "openai_responses"] as const) {
      for (const credentialEnvVar of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]) {
        const headers = upstreamAuthHeaders({
          protocol,
          credential: "sk-test",
          credentialEnvVar,
        })
        expect(headers, `${protocol} + ${credentialEnvVar}`).toEqual([
          { name: "authorization", value: "Bearer sk-test" },
        ])
      }
    }
  })

  it("keeps env-var semantics for Anthropic Messages upstreams", () => {
    expect(
      upstreamAuthHeaders({
        protocol: "anthropic",
        credential: "sk-test",
        credentialEnvVar: "ANTHROPIC_API_KEY",
      }),
    ).toEqual([{ name: "x-api-key", value: "sk-test" }])

    expect(
      upstreamAuthHeaders({
        protocol: "anthropic",
        credential: "sk-test",
        credentialEnvVar: "ANTHROPIC_AUTH_TOKEN",
      }),
    ).toEqual([{ name: "authorization", value: "Bearer sk-test" }])
  })

  it("defaults an unspecified credential source to x-api-key for Anthropic", () => {
    expect(upstreamAuthHeaders({ protocol: "anthropic", credential: "sk-test" })).toEqual([
      { name: "x-api-key", value: "sk-test" },
    ])
  })

  it("matches the env var name case-insensitively", () => {
    expect(
      upstreamAuthHeaders({
        protocol: "anthropic",
        credential: "tok",
        credentialEnvVar: "anthropic_auth_token",
      }),
    ).toEqual([{ name: "authorization", value: "Bearer tok" }])
  })

  it("emits no auth header for an empty credential", () => {
    expect(upstreamAuthHeaders({ protocol: "openai_chat", credential: "" })).toEqual([])
    expect(
      upstreamAuthHeaders({
        protocol: "anthropic",
        credential: "",
        credentialEnvVar: "ANTHROPIC_API_KEY",
      }),
    ).toEqual([])
  })

  it("the same env produces different headers for different upstream protocols", () => {
    // The regression the borrowing fixes: one provider record, one env var,
    // two possible upstream protocols — the header must follow the protocol.
    const base = { credential: "sk-test", credentialEnvVar: "ANTHROPIC_API_KEY" } as const
    const chat = upstreamAuthHeaders({ ...base, protocol: "openai_chat" })
    const responses = upstreamAuthHeaders({ ...base, protocol: "openai_responses" })
    const messages = upstreamAuthHeaders({ ...base, protocol: "anthropic" })
    expect(chat[0]?.name).toBe("authorization")
    expect(responses[0]?.name).toBe("authorization")
    expect(messages[0]?.name).toBe("x-api-key")
  })
})
