import { describe, expect, it } from "vitest"

import {
  CredentialLeaseProtocolError,
  createCredentialLeaseFailureResponse,
  createCredentialLeaseSuccessResponse,
  parseCredentialLeaseRequest,
  parseCredentialLeaseResponse,
} from "../src/index.js"

const CAPABILITY = "a".repeat(64)

function expectProtocolCode(fn: () => unknown, code: string): void {
  try {
    fn()
    expect.unreachable("expected the call to throw")
  } catch (error) {
    expect(error).toBeInstanceOf(CredentialLeaseProtocolError)
    expect((error as CredentialLeaseProtocolError).code).toBe(code)
  }
}

describe("parseCredentialLeaseRequest", () => {
  it("accepts a valid status request", () => {
    expect(
      parseCredentialLeaseRequest({
        version: 1,
        requestId: "req-1",
        capability: CAPABILITY,
        method: "status",
      }),
    ).toEqual({ version: 1, requestId: "req-1", capability: CAPABILITY, method: "status" })
  })

  it("accepts a valid lease request with a bounded minValidityMs", () => {
    expect(
      parseCredentialLeaseRequest({
        version: 1,
        requestId: "req:2",
        capability: CAPABILITY,
        method: "lease",
        minValidityMs: 30_000,
      }),
    ).toEqual({
      version: 1,
      requestId: "req:2",
      capability: CAPABILITY,
      method: "lease",
      minValidityMs: 30_000,
    })
  })

  it("accepts a valid unauthorized request with a generation", () => {
    expect(
      parseCredentialLeaseRequest({
        version: 1,
        requestId: "req-3",
        capability: CAPABILITY,
        method: "unauthorized",
        generation: 7,
      }),
    ).toEqual({
      version: 1,
      requestId: "req-3",
      capability: CAPABILITY,
      method: "unauthorized",
      generation: 7,
    })
  })

  it("accepts minValidityMs at both bounds of the allowed range", () => {
    const base = { version: 1, requestId: "req-4", capability: CAPABILITY, method: "lease" }
    expect(parseCredentialLeaseRequest({ ...base, minValidityMs: 0 })).toMatchObject({
      minValidityMs: 0,
    })
    expect(parseCredentialLeaseRequest({ ...base, minValidityMs: 5 * 60 * 1000 })).toMatchObject({
      minValidityMs: 5 * 60 * 1000,
    })
  })

  it("rejects an unsupported protocol version", () => {
    expectProtocolCode(
      () =>
        parseCredentialLeaseRequest({
          version: 2,
          requestId: "req-1",
          capability: CAPABILITY,
          method: "status",
        }),
      "PROTOCOL_MISMATCH",
    )
  })

  it("rejects non-object frames", () => {
    expectProtocolCode(() => parseCredentialLeaseRequest(null), "INVALID_REQUEST")
    expectProtocolCode(() => parseCredentialLeaseRequest("status"), "INVALID_REQUEST")
    expectProtocolCode(() => parseCredentialLeaseRequest([1]), "INVALID_REQUEST")
  })

  it("rejects malformed request ids", () => {
    const base = { version: 1, capability: CAPABILITY, method: "status" }
    expectProtocolCode(
      () => parseCredentialLeaseRequest({ ...base, requestId: "" }),
      "INVALID_REQUEST",
    )
    expectProtocolCode(
      () => parseCredentialLeaseRequest({ ...base, requestId: "bad id!" }),
      "INVALID_REQUEST",
    )
    expectProtocolCode(
      () => parseCredentialLeaseRequest({ ...base, requestId: "x".repeat(129) }),
      "INVALID_REQUEST",
    )
    expectProtocolCode(
      () => parseCredentialLeaseRequest({ ...base, requestId: 5 }),
      "INVALID_REQUEST",
    )
  })

  it("rejects malformed capabilities", () => {
    const base = { version: 1, requestId: "req-5", method: "status" }
    expectProtocolCode(
      () => parseCredentialLeaseRequest({ ...base, capability: "short" }),
      "INVALID_REQUEST",
    )
    expectProtocolCode(
      () => parseCredentialLeaseRequest({ ...base, capability: "g".repeat(64) }),
      "INVALID_REQUEST",
    )
  })

  it("rejects unknown methods", () => {
    expectProtocolCode(
      () =>
        parseCredentialLeaseRequest({
          version: 1,
          requestId: "req-6",
          capability: CAPABILITY,
          method: "revoke",
        }),
      "INVALID_REQUEST",
    )
  })

  it("rejects unexpected extra keys per method", () => {
    expectProtocolCode(
      () =>
        parseCredentialLeaseRequest({
          version: 1,
          requestId: "req-7",
          capability: CAPABILITY,
          method: "status",
          minValidityMs: 0,
        }),
      "INVALID_REQUEST",
    )
    expectProtocolCode(
      () =>
        parseCredentialLeaseRequest({
          version: 1,
          requestId: "req-8",
          capability: CAPABILITY,
          method: "unauthorized",
        }),
      "INVALID_REQUEST",
    )
  })

  it("rejects out-of-range or non-integer minValidityMs", () => {
    const base = { version: 1, requestId: "req-9", capability: CAPABILITY, method: "lease" }
    expectProtocolCode(
      () => parseCredentialLeaseRequest({ ...base, minValidityMs: -1 }),
      "INVALID_REQUEST",
    )
    expectProtocolCode(
      () => parseCredentialLeaseRequest({ ...base, minValidityMs: 1.5 }),
      "INVALID_REQUEST",
    )
    expectProtocolCode(
      () => parseCredentialLeaseRequest({ ...base, minValidityMs: 5 * 60 * 1000 + 1 }),
      "INVALID_REQUEST",
    )
    expectProtocolCode(
      () => parseCredentialLeaseRequest({ ...base, minValidityMs: "0" }),
      "INVALID_REQUEST",
    )
  })

  it("rejects out-of-range or non-integer generations", () => {
    const base = { version: 1, requestId: "req-10", capability: CAPABILITY, method: "unauthorized" }
    expectProtocolCode(
      () => parseCredentialLeaseRequest({ ...base, generation: -1 }),
      "INVALID_REQUEST",
    )
    expectProtocolCode(
      () => parseCredentialLeaseRequest({ ...base, generation: 2.5 }),
      "INVALID_REQUEST",
    )
  })
})

describe("parseCredentialLeaseResponse", () => {
  it("accepts a status result with and without expiry metadata", () => {
    expect(
      parseCredentialLeaseResponse({
        version: 1,
        requestId: "r1",
        ok: true,
        result: { method: "status", status: "anonymous", generation: 0 },
      }),
    ).toEqual({
      version: 1,
      requestId: "r1",
      ok: true,
      result: { method: "status", status: "anonymous", generation: 0 },
    })
    expect(
      parseCredentialLeaseResponse({
        version: 1,
        requestId: "r1",
        ok: true,
        result: { method: "status", status: "authenticated", generation: 3, expiresAtMs: 1000 },
      }),
    ).toMatchObject({ result: { expiresAtMs: 1000 } })
  })

  it("accepts a lease result and normalizes audience and scopes", () => {
    expect(
      parseCredentialLeaseResponse({
        version: 1,
        requestId: "r2",
        ok: true,
        result: {
          method: "lease",
          accessToken: "token",
          expiresAtMs: 5000,
          generation: 1,
          audience: "maximilian-provider",
          scopes: ["provider.default"],
        },
      }).result,
    ).toEqual({
      method: "lease",
      accessToken: "token",
      expiresAtMs: 5000,
      generation: 1,
      audience: "maximilian-provider",
      scopes: ["provider.default"],
    })
  })

  it("accepts an unauthorized result", () => {
    expect(
      parseCredentialLeaseResponse({
        version: 1,
        requestId: "r3",
        ok: true,
        result: { method: "unauthorized", action: "retry" },
      }).result,
    ).toEqual({ method: "unauthorized", action: "retry" })
  })

  it("accepts a failure response carrying the canonical error message", () => {
    expect(
      parseCredentialLeaseResponse({
        version: 1,
        requestId: "r4",
        ok: false,
        error: { code: "AUTH_REQUIRED", message: "Authentication is required." },
      }),
    ).toEqual({
      version: 1,
      requestId: "r4",
      ok: false,
      error: { code: "AUTH_REQUIRED", message: "Authentication is required." },
    })
  })

  it("rejects an unknown protocol version", () => {
    expectProtocolCode(
      () =>
        parseCredentialLeaseResponse({
          version: 9,
          requestId: "r5",
          ok: true,
          result: { method: "status", status: "anonymous", generation: 0 },
        }),
      "PROTOCOL_MISMATCH",
    )
  })

  it("rejects success results with unknown methods, statuses, or actions", () => {
    expectProtocolCode(
      () =>
        parseCredentialLeaseResponse({
          version: 1,
          requestId: "r6",
          ok: true,
          result: { method: "nope" },
        }),
      "INVALID_REQUEST",
    )
    expectProtocolCode(
      () =>
        parseCredentialLeaseResponse({
          version: 1,
          requestId: "r6",
          ok: true,
          result: { method: "status", status: "detached", generation: 0 },
        }),
      "INVALID_REQUEST",
    )
    expectProtocolCode(
      () =>
        parseCredentialLeaseResponse({
          version: 1,
          requestId: "r6",
          ok: true,
          result: { method: "unauthorized", action: "panic" },
        }),
      "INVALID_REQUEST",
    )
  })

  it("rejects lease results with wrong audience, scopes, or token shape", () => {
    const result = {
      method: "lease",
      accessToken: "token",
      expiresAtMs: 5000,
      generation: 1,
      audience: "maximilian-provider",
      scopes: ["provider.default"],
    }
    expectProtocolCode(
      () =>
        parseCredentialLeaseResponse({
          version: 1,
          requestId: "r7",
          ok: true,
          result: { ...result, audience: "other" },
        }),
      "INVALID_REQUEST",
    )
    expectProtocolCode(
      () =>
        parseCredentialLeaseResponse({
          version: 1,
          requestId: "r7",
          ok: true,
          result: { ...result, scopes: ["provider.default", "extra"] },
        }),
      "INVALID_REQUEST",
    )
    expectProtocolCode(
      () =>
        parseCredentialLeaseResponse({
          version: 1,
          requestId: "r7",
          ok: true,
          result: { ...result, accessToken: "" },
        }),
      "INVALID_REQUEST",
    )
    expectProtocolCode(
      () =>
        parseCredentialLeaseResponse({
          version: 1,
          requestId: "r7",
          ok: true,
          result: { ...result, expiresAtMs: -1 },
        }),
      "INVALID_REQUEST",
    )
  })

  it("rejects a failure response whose message does not match the canonical text", () => {
    expectProtocolCode(
      () =>
        parseCredentialLeaseResponse({
          version: 1,
          requestId: "r8",
          ok: false,
          error: { code: "AUTH_REQUIRED", message: "custom" },
        }),
      "INVALID_REQUEST",
    )
    expectProtocolCode(
      () =>
        parseCredentialLeaseResponse({
          version: 1,
          requestId: "r8",
          ok: false,
          error: { code: "UNKNOWN_CODE", message: "Authentication is required." },
        }),
      "INVALID_REQUEST",
    )
  })

  it("rejects responses without a boolean ok flag", () => {
    expectProtocolCode(
      () => parseCredentialLeaseResponse({ version: 1, requestId: "r9", ok: "yes" }),
      "INVALID_REQUEST",
    )
  })
})

describe("response builders", () => {
  it("maps protocol errors onto their code and anything else onto INTERNAL_ERROR", () => {
    expect(
      createCredentialLeaseFailureResponse(
        "r1",
        new CredentialLeaseProtocolError("CAPABILITY_REJECTED"),
      ),
    ).toMatchObject({ ok: false, error: { code: "CAPABILITY_REJECTED" } })
    expect(createCredentialLeaseFailureResponse("r1", new Error("boom"))).toMatchObject({
      ok: false,
      error: { code: "INTERNAL_ERROR" },
    })
  })

  it("rejects malformed request ids in failure responses", () => {
    expectProtocolCode(
      () => createCredentialLeaseFailureResponse("bad id!", new Error("boom")),
      "INVALID_REQUEST",
    )
  })

  it("round-trips success responses through the strict parser", () => {
    const response = createCredentialLeaseSuccessResponse("r2", {
      method: "status",
      status: "authenticated",
      generation: 2,
      expiresAtMs: 1234,
    })
    expect(response).toMatchObject({ version: 1, requestId: "r2", ok: true })
    expect(parseCredentialLeaseResponse(response)).toEqual(response)
  })

  it("refuses to build a success response that the parser would reject", () => {
    expectProtocolCode(
      () =>
        createCredentialLeaseSuccessResponse("r3", {
          method: "status",
          status: "not-a-status" as "anonymous",
          generation: 0,
        }),
      "INVALID_REQUEST",
    )
  })
})
