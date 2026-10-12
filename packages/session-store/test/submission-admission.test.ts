// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest"
import {
  SYSTEM_KIND_PREFIX,
  admitSubmission,
  affectsModelContext,
  hasQueuedReset,
  isDisplayOnlySubmission,
  type QueuedSubmission,
  type SubmissionDraft,
} from "../src/submission-admission.js"

const displayWrite = (overrides: Partial<SubmissionDraft> = {}): SubmissionDraft => ({
  type: "write",
  display: { kind: "ui.title", data: "Session title" },
  ...overrides,
})

const queued = (draft: SubmissionDraft, id = "q1"): QueuedSubmission => ({ id, draft })

describe("isDisplayOnlySubmission", () => {
  it("accepts a write with only a display payload", () => {
    expect(isDisplayOnlySubmission(displayWrite())).toBe(true)
  })

  it("rejects non-write submissions", () => {
    expect(isDisplayOnlySubmission({ type: "input", content: "hi" })).toBe(false)
    expect(isDisplayOnlySubmission({ type: "reset", head: "self" })).toBe(false)
  })

  it("rejects writes that touch model/head/edits — any one disqualifies", () => {
    expect(isDisplayOnlySubmission(displayWrite({ model: { text: "visible" } }))).toBe(false)
    expect(isDisplayOnlySubmission(displayWrite({ head: 42 }))).toBe(false)
    expect(isDisplayOnlySubmission(displayWrite({ edits: [{ id: "e1" }] }))).toBe(false)
  })

  it("rejects writes with no display payload at all (an empty write is not display-only)", () => {
    expect(isDisplayOnlySubmission({ type: "write" })).toBe(false)
  })

  it("rejects empty or non-string kinds", () => {
    expect(isDisplayOnlySubmission({ type: "write", display: { kind: "" } })).toBe(false)
    expect(isDisplayOnlySubmission({ type: "write", display: { kind: 3 } })).toBe(false)
    expect(isDisplayOnlySubmission({ type: "write", display: {} })).toBe(false)
  })

  it("rejects kinds squatting the reserved system namespace", () => {
    expect(
      isDisplayOnlySubmission({ type: "write", display: { kind: `${SYSTEM_KIND_PREFIX}user` } }),
    ).toBe(false)
  })
})

describe("admitSubmission — the display-only bypass", () => {
  it("bypasses a busy run and lands ahead of earlier queued items", () => {
    const state = {
      busy: true,
      queued: [queued({ type: "input", content: "earlier question" })],
    }
    const admission = admitSubmission(displayWrite(), state)
    expect(admission.decision).toBe("bypass-immediate")
    expect(admission.behindCount).toBeUndefined()
  })

  it("bypasses even when idle with a non-empty queue (ahead of the queue)", () => {
    const state = { busy: false, queued: [queued({ type: "write", model: { text: "x" } })] }
    expect(admitSubmission(displayWrite(), state).decision).toBe("bypass-immediate")
  })

  it("the one exception: a queued reset holds the display-only write back", () => {
    const state = {
      busy: true,
      queued: [queued({ type: "reset", head: "self" })],
    }
    const admission = admitSubmission(displayWrite(), state)
    expect(admission.decision).toBe("queue")
    expect(admission.behindCount).toBe(1)
    expect(admission.reason).toContain("reset")
  })

  it("a reset queued behind other items still holds display-only writes", () => {
    const state = {
      busy: false,
      queued: [
        queued({ type: "input", content: "q" }, "q1"),
        queued({ type: "reset", head: "self" }, "q2"),
      ],
    }
    expect(admitSubmission(displayWrite(), state).decision).toBe("queue")
  })
})

describe("admitSubmission — the ordinary ladder is unchanged", () => {
  const idle = { busy: false, queued: [] as QueuedSubmission[] }

  it("idle input runs", () => {
    expect(admitSubmission({ type: "input", content: "go" }, idle)).toEqual({
      decision: "run",
      reason: expect.any(String),
    })
  })

  it("busy input queues at the back", () => {
    const state = { busy: true, queued: [queued({ type: "input", content: "first" })] }
    const admission = admitSubmission({ type: "input", content: "second" }, state)
    expect(admission.decision).toBe("queue")
    expect(admission.behindCount).toBe(1)
  })

  it("idle input with queued items queues behind them", () => {
    const state = { busy: false, queued: [queued({ type: "write", model: { text: "w" } })] }
    const admission = admitSubmission({ type: "input", content: "later" }, state)
    expect(admission.decision).toBe("queue")
    expect(admission.behindCount).toBe(1)
  })

  it("reject-busy input on a busy run is refused", () => {
    const admission = admitSubmission(
      { type: "input", content: "now", whenBusy: "reject" },
      { busy: true, queued: [] },
    )
    expect(admission.decision).toBe("reject-busy")
  })

  it("reject-busy input on an IDLE run still runs", () => {
    const admission = admitSubmission({ type: "input", content: "now", whenBusy: "reject" }, idle)
    expect(admission.decision).toBe("run")
  })

  it("an ordinary (context-touching) write queues even when idle with items", () => {
    const state = { busy: false, queued: [queued({ type: "input", content: "q" })] }
    const admission = admitSubmission({ type: "write", model: { text: "m" } }, state)
    expect(admission.decision).toBe("queue")
  })

  it("an ordinary write on an idle empty conversation runs", () => {
    expect(admitSubmission({ type: "write", model: { text: "m" } }, idle).decision).toBe("run")
  })

  it("a reset always queues or runs through the ordinary ladder — never bypasses", () => {
    const state = { busy: true, queued: [] as QueuedSubmission[] }
    expect(admitSubmission({ type: "reset", head: "self" }, state).decision).toBe("queue")
  })
})

describe("hasQueuedReset / affectsModelContext", () => {
  it("detects a queued reset by type or by head=self", () => {
    expect(hasQueuedReset([queued({ type: "reset", head: "self" })])).toBe(true)
    expect(hasQueuedReset([queued({ type: "write", head: "self" })])).toBe(true)
    expect(hasQueuedReset([queued({ type: "input", content: "x" })])).toBe(false)
    expect(hasQueuedReset([])).toBe(false)
  })

  it("grades context impact", () => {
    expect(affectsModelContext({ type: "input", content: "x" })).toBe(true)
    expect(affectsModelContext({ type: "reset", head: "self" })).toBe(true)
    expect(affectsModelContext({ type: "write", model: { text: "m" } })).toBe(true)
    expect(affectsModelContext(displayWrite())).toBe(false)
  })
})
