// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Feedback module tests (P2 privacy-friendly in-product feedback).
 *
 * Covers the payload privacy boundary, the injectable transports, consent
 * independence, survey-metadata caching, and the JSONL file sink.
 *
 * Borrowing: OpenHands feedback-button.test.tsx /
 * submitPrivateFeedback assertions (OpenHands src/services/telemetry.ts).
 */

import { afterEach, describe, expect, it } from "vitest"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  buildFeedbackPayload,
  CachingFeedbackSurveyProvider,
  FeedbackSubmissionError,
  FetchFeedbackTransport,
  PostHogFeedbackSurveyProvider,
  StaticFeedbackSurveyProvider,
  submitFeedback,
  type FeedbackDelivery,
  type FeedbackPayload,
  type FeedbackSurvey,
  type FeedbackSurveyProvider,
  type FeedbackTransport,
} from "../src/feedback/index.js"
import {
  FEEDBACK_PATH_ENV,
  FileFeedbackTransport,
  resolveFileFeedbackTransport,
} from "../src/feedback/transports/file-transport.js"

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

class MemoryTransport implements FeedbackTransport {
  readonly name = "memory"
  readonly payloads: FeedbackPayload[] = []
  next: FeedbackDelivery = { ok: true }

  async deliver(payload: FeedbackPayload): Promise<FeedbackDelivery> {
    this.payloads.push(payload)
    return this.next
  }
}

afterEach(() => {
  delete process.env.DO_NOT_TRACK
})

// ── Payload privacy boundary ─────────────────────────────────────────────────

describe("buildFeedbackPayload", () => {
  it("uses a random UUID distinct_id that is never the contact email", () => {
    const first = buildFeedbackPayload({
      message: "hello",
      email: "person@example.com",
      source: "test",
    })
    const second = buildFeedbackPayload({ message: "hello", source: "test" })

    expect(first.distinct_id).toMatch(UUID_V4)
    expect(second.distinct_id).toMatch(UUID_V4)
    expect(first.distinct_id).not.toBe(second.distinct_id)
    expect(first.distinct_id).not.toBe("person@example.com")
  })

  it("omits the email field entirely when empty or whitespace-only", () => {
    for (const email of [undefined, "", "   ", "\n\t "]) {
      const payload = buildFeedbackPayload({ message: "hi", email, source: "test" })
      expect(payload.properties.feedback_email).toBeUndefined()
      expect("feedback_email" in payload.properties).toBe(false)
    }
  })

  it("trims and includes a provided email", () => {
    const payload = buildFeedbackPayload({
      message: "hi",
      email: "  person@example.com  ",
      source: "test",
    })
    expect(payload.properties.feedback_email).toBe("person@example.com")
  })

  it("does not attach a person profile, ip, or current_url", () => {
    const payload = buildFeedbackPayload({ message: "hi", source: "test" })
    expect(payload.properties.$process_person_profile).toBe(false)
    expect(payload.ip).toBe(false)
    expect("$current_url" in payload.properties).toBe(false)
    expect(JSON.stringify(payload)).not.toContain("current_url")
  })

  it("includes survey metadata only when supplied", () => {
    const survey: FeedbackSurvey = { id: "s1", question: "What do you think?" }
    const withSurvey = buildFeedbackPayload({ message: "hi", source: "test", survey })
    expect(withSurvey.properties.$survey_id).toBe("s1")
    expect(withSurvey.properties.$survey_questions).toEqual([
      { id: "s1", question: "What do you think?" },
    ])

    const without = buildFeedbackPayload({ message: "hi", source: "test" })
    expect(without.properties.$survey_id).toBeUndefined()
    expect(without.properties.$survey_questions).toBeUndefined()
  })

  it("trims the message text", () => {
    const payload = buildFeedbackPayload({ message: "  padded  ", source: "test" })
    expect(payload.properties.$survey_response).toBe("padded")
  })
})

// ── Submission service ───────────────────────────────────────────────────────

describe("submitFeedback", () => {
  it("delivers through the injected transport", async () => {
    const transport = new MemoryTransport()
    await submitFeedback(
      { message: "  works  ", email: "a@b.co", source: "dashboard-settings" },
      { transport },
    )
    expect(transport.payloads).toHaveLength(1)
    expect(transport.payloads[0]!.properties.$survey_response).toBe("works")
    expect(transport.payloads[0]!.properties.feedback_source).toBe("dashboard-settings")
  })

  it("succeeds even when analytics hard-disable/DNT is set (consent-independent)", async () => {
    // Feedback must not consult analytics consent. DNT is the closest global
    // switch in the upstream implementation; deny it and still deliver.
    process.env.DO_NOT_TRACK = "1"
    const transport = new MemoryTransport()
    await submitFeedback({ message: "still delivered", source: "test" }, { transport })
    expect(transport.payloads).toHaveLength(1)
  })

  it("throws FeedbackSubmissionError when the transport does not acknowledge", async () => {
    const transport = new MemoryTransport()
    transport.next = { ok: false, reason: "not-acknowledged" }
    await expect(
      submitFeedback({ message: "draft", source: "test" }, { transport }),
    ).rejects.toBeInstanceOf(FeedbackSubmissionError)
    // The payload was attempted but not confirmed delivered.
    expect(transport.payloads).toHaveLength(1)
  })

  it("resolves survey metadata through the provider before sending", async () => {
    const transport = new MemoryTransport()
    await submitFeedback(
      { message: "q", source: "test" },
      {
        transport,
        surveyProvider: new StaticFeedbackSurveyProvider({
          id: "s9",
          question: "How is it?",
        }),
      },
    )
    expect(transport.payloads[0]!.properties.$survey_id).toBe("s9")
  })
})

// ── Fetch transport ──────────────────────────────────────────────────────────

describe("FetchFeedbackTransport", () => {
  function jsonResponse(status: number, body: unknown): Response {
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
  }

  it("omits credentials/referrer and posts the payload", async () => {
    let seen: { url: string; init: RequestInit } | null = null
    const fetchImpl = async (url: string, init: RequestInit) => {
      seen = { url, init }
      return jsonResponse(200, { status: "Ok" })
    }
    const transport = new FetchFeedbackTransport({
      endpoint: "https://relay.example/feedback",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    const delivery = await transport.deliver(buildFeedbackPayload({ message: "x", source: "t" }))
    expect(delivery.ok).toBe(true)
    expect(seen!.url).toBe("https://relay.example/feedback")
    expect(seen!.init.method).toBe("POST")
    expect(seen!.init.credentials).toBe("omit")
    expect(seen!.init.referrerPolicy).toBe("no-referrer")
    expect(JSON.parse(String(seen!.init.body)).event).toBe("survey sent")
  })

  it("treats an HTTP 200 without capture acknowledgement as failure", async () => {
    const transport = new FetchFeedbackTransport({
      endpoint: "https://relay.example/capture/",
      fetchImpl: (async () => jsonResponse(200, { status: "error" })) as unknown as typeof fetch,
    })
    const delivery = await transport.deliver(buildFeedbackPayload({ message: "x", source: "t" }))
    expect(delivery).toEqual({ ok: false, reason: "not-acknowledged" })
  })

  it("treats a non-2xx response as failure", async () => {
    const transport = new FetchFeedbackTransport({
      endpoint: "https://relay.example/capture/",
      fetchImpl: (async () => jsonResponse(503, null)) as unknown as typeof fetch,
    })
    const delivery = await transport.deliver(buildFeedbackPayload({ message: "x", source: "t" }))
    expect(delivery).toEqual({ ok: false, reason: "http-503" })
  })

  it("times out an endpoint that accepts the socket but never answers", async () => {
    let seenSignal: AbortSignal | undefined
    const transport = new FetchFeedbackTransport({
      endpoint: "https://relay.example/capture/",
      timeoutMs: 20,
      fetchImpl: (async (_url: string, init: RequestInit) => {
        seenSignal = init.signal ?? undefined
        return new Promise(() => {})
      }) as unknown as typeof fetch,
    })

    const started = Date.now()
    const delivery = await transport.deliver(buildFeedbackPayload({ message: "x", source: "t" }))
    expect(delivery).toEqual({ ok: false, reason: "timeout" })
    expect(Date.now() - started).toBeLessThan(500)
    // A spec-compliant fetch is cancelled, not just abandoned.
    expect(seenSignal?.aborted).toBe(true)
  })

  it("reports a timed-out body read as failure rather than a delivered relay", async () => {
    const transport = new FetchFeedbackTransport({
      endpoint: "https://relay.example/capture/",
      timeoutMs: 20,
      fetchImpl: (async () =>
        ({
          ok: true,
          status: 200,
          json: () => new Promise(() => {}),
        }) as unknown as Response) as unknown as typeof fetch,
    })
    const delivery = await transport.deliver(buildFeedbackPayload({ message: "x", source: "t" }))
    expect(delivery).toEqual({ ok: false, reason: "timeout" })
  })

  it("accepts a non-JSON 2xx relay and a network failure surfaces as failure", async () => {
    const nonJson = new FetchFeedbackTransport({
      endpoint: "https://relay.example/",
      fetchImpl: (async () => ({
        ok: true,
        status: 204,
        json: async () => {
          throw new Error("not json")
        },
      })) as unknown as typeof fetch,
    })
    expect((await nonJson.deliver(buildFeedbackPayload({ message: "x", source: "t" }))).ok).toBe(
      true,
    )

    const offline = new FetchFeedbackTransport({
      endpoint: "https://relay.example/",
      fetchImpl: (async () => {
        throw new Error("offline")
      }) as unknown as typeof fetch,
    })
    expect(await offline.deliver(buildFeedbackPayload({ message: "x", source: "t" }))).toEqual({
      ok: false,
      reason: "network-error",
    })
  })
})

// ── Survey providers ────────────────────────────────────────────────────────

describe("survey providers", () => {
  it("reuses a successful lookup and retries after a failure", async () => {
    let calls = 0
    const inner: FeedbackSurveyProvider = {
      async load() {
        calls += 1
        if (calls <= 2) throw new Error("offline")
        return { id: "s1", question: "Q?" }
      },
    }
    const provider = new CachingFeedbackSurveyProvider(inner)

    await expect(provider.load()).rejects.toThrow("offline")
    await expect(provider.load()).rejects.toThrow("offline")
    expect(await provider.load()).toEqual({ id: "s1", question: "Q?" })
    expect(await provider.load()).toEqual({ id: "s1", question: "Q?" })
    expect(calls).toBe(3)
  })

  it("resolves exactly one question from the configured PostHog survey", async () => {
    const fetchImpl = async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          surveys: [
            { id: "other", questions: [{ id: "q0", question: "no" }] },
            { id: "wanted", questions: [{ id: "q1", question: "Your feedback?" }] },
          ],
        }),
      }) as unknown as typeof fetch
    const provider = new PostHogFeedbackSurveyProvider({
      host: "https://ph.example/",
      apiKey: "token",
      surveyId: "wanted",
      fetchImpl,
    })
    expect(await provider.load()).toEqual({ id: "q1", question: "Your feedback?" })
  })

  it("rejects a survey without exactly one question", async () => {
    const fetchImpl = async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          surveys: [{ id: "wanted", questions: [] }],
        }),
      }) as unknown as typeof fetch
    const provider = new PostHogFeedbackSurveyProvider({
      host: "https://ph.example",
      apiKey: "token",
      surveyId: "wanted",
      fetchImpl,
    })
    await expect(provider.load()).rejects.toThrow("Feedback survey unavailable")
  })
})

// ── File transport / env resolution ─────────────────────────────────────────

describe("FileFeedbackTransport", () => {
  it("appends one JSONL record per submission and flushes pending writes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mx-feedback-"))
    try {
      const file = join(dir, "nested", "feedback.jsonl")
      const transport = new FileFeedbackTransport(file)
      const first = buildFeedbackPayload({ message: "one", source: "t" })
      const second = buildFeedbackPayload({ message: "two", source: "t" })

      expect(await transport.deliver(first)).toEqual({ ok: true })
      expect(await transport.deliver(second)).toEqual({ ok: true })
      await transport.flush()

      const lines = readFileSync(file, "utf8").trim().split("\n")
      expect(lines).toHaveLength(2)
      expect(JSON.parse(lines[0]!)).toEqual(first)
      expect(JSON.parse(lines[1]!)).toEqual(second)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("reports an io failure instead of throwing into the caller's queue", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mx-feedback-"))
    try {
      // A directory at the file path makes appendFile fail (EISDIR).
      const transport = new FileFeedbackTransport(dir)
      expect(await transport.deliver(buildFeedbackPayload({ message: "x", source: "t" }))).toEqual({
        ok: false,
        reason: "io-error",
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("resolves only when MAXIMILIAN_FEEDBACK_PATH is set", () => {
    const previous = process.env[FEEDBACK_PATH_ENV]
    delete process.env[FEEDBACK_PATH_ENV]
    expect(resolveFileFeedbackTransport()).toBeNull()

    process.env[FEEDBACK_PATH_ENV] = "  "
    expect(resolveFileFeedbackTransport()).toBeNull()

    process.env[FEEDBACK_PATH_ENV] = "/tmp/mx-feedback.jsonl"
    expect(resolveFileFeedbackTransport()?.name).toBe("file")

    if (previous === undefined) delete process.env[FEEDBACK_PATH_ENV]
    else process.env[FEEDBACK_PATH_ENV] = previous
  })

  it("rejects direct construction with a blank path", () => {
    expect(() => new FileFeedbackTransport("   ")).toThrow(/not configured/i)
  })
})
