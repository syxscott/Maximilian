// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Feedback domain tests — model units plus render smoke for the settings
 * feedback card (settings-deep.test.tsx pattern).
 *
 * Borrowing: OpenHands feedback-button.test.tsx assertions — optional email,
 * malformed email blocks submit, a failed capture keeps the draft, anonymous
 * submissions carry a random distinct_id.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import {
  FetchFeedbackTransport,
  type FeedbackDelivery,
  type FeedbackPayload,
  type FeedbackTransport,
} from "@max/telemetry/feedback"

import { FeedbackSection } from "../src/components/settings/feedback-domain/FeedbackSection"
import {
  FEEDBACK_EMAIL_MAX_LENGTH,
  FEEDBACK_MESSAGE_MAX_LENGTH,
  hasFeedbackDraft,
  isValidOptionalEmail,
} from "../src/components/settings/feedback-domain/model"
import { resolveDashboardFeedbackTransport } from "../src/components/settings/feedback-domain/transport"

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

const sendButton = () => screen.getByRole("button", { name: "Send feedback" })
const messageBox = () => screen.getByLabelText(/Your feedback/)
const emailBox = () => screen.getByLabelText(/^Email/)

beforeEach(() => {
  document.body.innerHTML = ""
})

// ── Model ───────────────────────────────────────────────────────────────────

describe("feedback model", () => {
  it("accepts blank or well-formed optional emails only", () => {
    expect(isValidOptionalEmail("")).toBe(true)
    expect(isValidOptionalEmail("   ")).toBe(true)
    expect(isValidOptionalEmail("person@example.com")).toBe(true)
    expect(isValidOptionalEmail("not-an-email")).toBe(false)
    expect(isValidOptionalEmail("a@b")).toBe(false)
    expect(isValidOptionalEmail("a".repeat(FEEDBACK_EMAIL_MAX_LENGTH + 1))).toBe(false)
  })

  it("detects a draft worth preserving", () => {
    expect(hasFeedbackDraft("", "")).toBe(false)
    expect(hasFeedbackDraft("  ", "")).toBe(false)
    expect(hasFeedbackDraft("idea", "")).toBe(true)
    expect(hasFeedbackDraft("", " person@example.com ")).toBe(true)
  })

  it("exposes sane field limits", () => {
    expect(FEEDBACK_MESSAGE_MAX_LENGTH).toBeGreaterThan(0)
    expect(FEEDBACK_EMAIL_MAX_LENGTH).toBe(254)
  })
})

// ── Transport resolution ────────────────────────────────────────────────────

describe("resolveDashboardFeedbackTransport", () => {
  it("returns null when no endpoint is configured", () => {
    expect(resolveDashboardFeedbackTransport({})).toBeNull()
    expect(
      resolveDashboardFeedbackTransport({ VITE_MAXIMILIAN_FEEDBACK_ENDPOINT: "  " }),
    ).toBeNull()
  })

  it("builds a fetch transport for a configured self-hosted endpoint", () => {
    const transport = resolveDashboardFeedbackTransport({
      VITE_MAXIMILIAN_FEEDBACK_ENDPOINT: " https://relay.example/feedback ",
    })
    expect(transport?.name).toBe("fetch")
  })
})

// ── Card states ─────────────────────────────────────────────────────────────

describe("FeedbackSection", () => {
  it("shows an honest unconfigured notice and disables sending", () => {
    render(<FeedbackSection transport={null} />)
    expect(screen.getByTestId("feedback-unconfigured")).toHaveTextContent(/not configured/i)
    expect(sendButton()).toBeDisabled()
  })

  it("submits anonymously with a random UUID and no email/current_url", async () => {
    const transport = new MemoryTransport()
    render(<FeedbackSection transport={transport} />)

    fireEvent.change(messageBox(), { target: { value: "Make this easier" } })
    fireEvent.change(emailBox(), { target: { value: "   " } })
    fireEvent.click(sendButton())

    await waitFor(() => expect(screen.getByTestId("feedback-sent")).toBeInTheDocument())
    expect(transport.payloads).toHaveLength(1)
    const payload = transport.payloads[0]!
    expect(payload.distinct_id).toMatch(UUID_V4)
    expect(payload.properties.feedback_email).toBeUndefined()
    expect(payload.properties.$process_person_profile).toBe(false)
    expect(payload.ip).toBe(false)
    expect(JSON.stringify(payload)).not.toContain("current_url")
    // Draft cleared after a confirmed delivery.
    expect(screen.queryByLabelText(/Your feedback/)).not.toBeInTheDocument()
  })

  it("keeps the draft when the transport does not acknowledge", async () => {
    const transport = new MemoryTransport()
    transport.next = { ok: false, reason: "not-acknowledged" }
    render(<FeedbackSection transport={transport} />)

    fireEvent.change(messageBox(), { target: { value: "A draft worth keeping" } })
    fireEvent.change(emailBox(), { target: { value: "person@example.com" } })
    fireEvent.click(sendButton())

    await waitFor(() => expect(screen.getByTestId("feedback-error")).toBeInTheDocument())
    expect(messageBox()).toHaveValue("A draft worth keeping")
    expect(emailBox()).toHaveValue("person@example.com")
    expect(screen.queryByTestId("feedback-sent")).not.toBeInTheDocument()
  })

  it("blocks submission for a malformed optional email", () => {
    const transport = new MemoryTransport()
    render(<FeedbackSection transport={transport} />)

    fireEvent.change(messageBox(), { target: { value: "hello" } })
    fireEvent.change(emailBox(), { target: { value: "not-an-email" } })
    expect(sendButton()).toBeDisabled()

    fireEvent.change(emailBox(), { target: { value: "person@example.com" } })
    expect(sendButton()).toBeEnabled()
    expect(transport.payloads).toHaveLength(0)
  })

  it("treats an HTTP 200 without a capture acknowledgement as failure", async () => {
    const transport = new FetchFeedbackTransport({
      endpoint: "https://relay.example/capture/",
      fetchImpl: async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ status: "error" }),
        }) as unknown as typeof fetch,
    })
    render(<FeedbackSection transport={transport} />)

    fireEvent.change(messageBox(), { target: { value: "capture rejected" } })
    fireEvent.click(sendButton())

    await waitFor(() => expect(screen.getByTestId("feedback-error")).toBeInTheDocument())
    expect(messageBox()).toHaveValue("capture rejected")
  })
})
