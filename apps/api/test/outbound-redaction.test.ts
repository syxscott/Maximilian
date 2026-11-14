// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// (minimax-code 9a93560 borrowing) Outbound error redaction wiring tests:
//   - the test-chat probe (502 path) passes THIS request's secrets (the
//     provider's configured key + the request's credential headers) through
//     the redactor and never ships the raw key-bearing message
//   - the jobs dispatch-failed event redacts the BullMQ error before it
//     enters the event stream
//
// The redactor implementation lives in @max/providers (pinned contract:
// `redactOutboundError(message, secrets)`). These tests inject a stub to
// observe WHICH secrets each call site passes; the default-wiring tests
// exercise the real providers implementation through the same call sites.
// No redaction logic is reimplemented in the api package.

import { describe, it, expect, afterEach } from "vitest"
import { OpenAPIHono } from "@hono/zod-openapi"
import type { ProviderRegistry } from "@max/providers"
import { providerTestChatRoute, providerTestChatHandler } from "../src/routes/system.js"
import { createJobsRegistry, type JobsQueuePort } from "../src/routes/jobs.js"
import {
  collectHeaderSecrets,
  collectOutboundSecrets,
  collectProviderSecrets,
  defaultOutboundRedactor,
  redactOutboundMessage,
  type OutboundRedactor,
} from "../src/lib/outbound-redaction.js"

const KEY = "sk-test-secret-0123456789"

/** Test stub standing in for the pinned @max/providers contract. */
const stubRedactor: OutboundRedactor = (message, secrets) => {
  let out = message
  for (const secret of secrets) out = out.split(secret).join("[REDACTED]")
  return out
}

const savedEnv: Record<string, string | undefined> = {}
const envKeysToRestore = ["OUTBOUND_REDACTION_TEST_KEY", "OPENAI_API_KEY"]

function setEnv(key: string, value: string | undefined): void {
  if (!(key in savedEnv)) savedEnv[key] = process.env[key]
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

afterEach(() => {
  for (const key of envKeysToRestore) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
})

describe("outbound redaction port", () => {
  it("defaults to the pinned @max/providers implementation", () => {
    expect(defaultOutboundRedactor("bad key " + KEY, [])).not.toContain(KEY)
    expect(defaultOutboundRedactor(`OpenAI 401: key ${KEY}`, [])).toContain("sk-***")
  })

  it("delegates to the injected redactor at the call sites", () => {
    expect(redactOutboundMessage("bad key " + KEY, [KEY], stubRedactor)).toBe("bad key [REDACTED]")
  })

  it("collects credential headers and ignores short or unrelated ones", () => {
    const headers = new Headers({
      authorization: `Bearer ${KEY}`,
      "x-api-key": "sk-header-key-987654321",
      "content-type": "application/json",
      "x-trace-id": "short",
    })
    const secrets = collectHeaderSecrets(headers)
    expect(secrets).toContain(KEY)
    expect(secrets).toContain("sk-header-key-987654321")
    expect(secrets).not.toContain("short")
  })

  it("scopes provider secrets to the requested provider preset", () => {
    setEnv("OUTBOUND_REDACTION_TEST_KEY", KEY)
    // Unknown provider → no preset → no secrets from this helper.
    expect(collectProviderSecrets("does-not-exist")).toEqual([])
  })

  it("joins header secrets and provider secrets for one failure", () => {
    setEnv("OPENAI_API_KEY", KEY)
    const headers = new Headers({ authorization: `Bearer sk-header-key-987654321` })
    const secrets = collectOutboundSecrets(headers, "openai")
    expect(secrets).toContain("sk-header-key-987654321")
    expect(secrets).toContain(KEY) // the openai preset's env key
  })
})

describe("test-chat probe — 502 is redacted before it leaves the process", () => {
  function makeApp(error: Error, captured: { secrets?: string[] }, redact?: OutboundRedactor) {
    const registry = {
      get(id: string) {
        return {
          id,
          name: id,
          defaultModel: "test-model",
          isConfigured: () => true,
          async chat() {
            throw error
          },
        }
      },
      getEffectiveDefaultModel: () => "test-model",
    } as unknown as ProviderRegistry
    const redactOutbound: OutboundRedactor | undefined = redact
      ? (message, secrets) => {
          captured.secrets = secrets
          return redact(message, secrets)
        }
      : undefined
    const app = new OpenAPIHono()
    app.openapi(providerTestChatRoute, providerTestChatHandler({ registry, redactOutbound }))
    return app
  }

  it("does not echo the key-bearing error text and receives the request secrets", async () => {
    const captured: { secrets?: string[] } = {}
    const app = makeApp(new Error(`OpenAI 401: API key ${KEY} is invalid`), captured, stubRedactor)

    const res = await app.request("/system/providers/openai/test-chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${KEY}`,
      },
      body: JSON.stringify({ prompt: "hello" }),
    })

    expect(res.status).toBe(502)
    const body = (await res.json()) as { error: string; durationMs: number }
    expect(body.error).not.toContain(KEY) // the raw key never ships
    expect(body.error).toContain("[REDACTED]")
    expect(body.durationMs).toBeTypeOf("number")
    // The redactor saw THIS request's secrets: the bearer token and the
    // provider's configured env key (when present).
    expect(captured.secrets).toContain(KEY)
  })

  it("redacts with the default providers implementation (sk-keys never ship)", async () => {
    const captured: { secrets?: string[] } = {}
    const app = makeApp(new Error(`OpenAI 401: API key ${KEY} is invalid`), captured)

    const res = await app.request("/system/providers/openai/test-chat", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ prompt: "hello" }),
    })

    const body = (await res.json()) as { error: string }
    expect(body.error).not.toContain(KEY)
    expect(body.error).toContain("***")
  })
})

describe("jobs dispatch-failed — BullMQ error is redacted before the event stream", () => {
  it("records a redacted error, not the raw queue failure", async () => {
    const captured: { secrets?: string[] } = {}
    const queue: JobsQueuePort = {
      available: true,
      async add() {
        throw new Error(`Redis AUTH failed using password ${KEY}`)
      },
    }
    const registry = createJobsRegistry({
      queue,
      redactOutbound: (message, secrets) => {
        captured.secrets = secrets
        return stubRedactor(message, secrets)
      },
      redactionSecrets: () => [KEY],
    })

    const created = registry.create({
      name: "redaction-probe",
      schedule: "*/5 * * * *",
      payload: { kind: "workspace", message: "hello" },
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const fired = await registry.trigger(created.job.id, "manual-trigger")
    expect(fired).toBeDefined()

    const entry = fired?.events.find((e) => e.kind === "dispatch-failed")
    expect(entry).toBeDefined()
    expect(entry?.error).not.toContain(KEY)
    expect(entry?.error).toContain("[REDACTED]")
    expect(captured.secrets).toContain(KEY)
  })

  it("redacts with the default providers implementation", async () => {
    const queue: JobsQueuePort = {
      available: true,
      async add() {
        throw new Error(`Redis AUTH failed using password ${KEY}`)
      },
    }
    const registry = createJobsRegistry({
      queue,
      redactionSecrets: () => [KEY],
    })

    const created = registry.create({
      name: "redaction-probe-2",
      schedule: "*/5 * * * *",
      payload: { kind: "workspace", message: "hello" },
    })
    if (!created.ok) throw new Error("job create failed")
    const fired = await registry.trigger(created.job.id, "manual-trigger")

    const entry = fired?.events.find((e) => e.kind === "dispatch-failed")
    expect(entry?.error).not.toContain(KEY)
    expect(entry?.error).toContain("***")
  })
})
