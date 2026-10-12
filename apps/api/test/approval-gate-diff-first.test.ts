// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Diff-first approval gate tests (oh-my-claudecode `77ba93621` borrowing):
 *   - gradeRelease is pure: an answer that DECLARED diffAttached:false is
 *     refused before the structural step; undeclared or satisfied evidence
 *     never blocks (the optional field tightens, never loosens).
 *   - release keeps the entry pending on refusal, so a later release with
 *     real evidence can succeed.
 *   - route flow through a mini Hono app: remote answer carrying
 *     evidence.diffAttached=false is held; the loopback release is refused
 *     403 diff_not_attached with the criterion; the runtime is untouched;
 *     the pending view exposes the evidence.
 */

import { describe, it, expect, vi } from "vitest"
import { Hono } from "hono"
import {
  DIFF_FIRST_CRITERION,
  RemoteApprovalGate,
  gradeRelease,
  parseGateEvidence,
} from "../src/lib/remote-approval-gate.js"
import { permissionsRoutes } from "../src/routes/permissions.js"
import { approvalGateRoutes } from "../src/routes/approval-gate.js"

const REMOTE = "203.0.113.9"
const envFor = (addr: string) => ({ incoming: { socket: { remoteAddress: addr } } })

function post(body: unknown): {
  method: "POST"
  body: string
  headers: { "content-type": string }
} {
  return {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }
}

describe("parseGateEvidence", () => {
  it("keeps only well-typed evidence; anything else is undeclared", () => {
    expect(parseGateEvidence({ diffAttached: false })).toEqual({ diffAttached: false })
    expect(parseGateEvidence({ diffAttached: true })).toEqual({ diffAttached: true })
    expect(parseGateEvidence({ diffAttached: "no" })).toBeUndefined()
    expect(parseGateEvidence({})).toBeUndefined()
    expect(parseGateEvidence("false")).toBeUndefined()
    expect(parseGateEvidence(null)).toBeUndefined()
    expect(parseGateEvidence(undefined)).toBeUndefined()
  })
})

describe("gradeRelease (pure diff-first grading)", () => {
  it("refuses when the answer declared diffAttached: false", () => {
    const verdict = gradeRelease({ evidence: { diffAttached: false } })
    expect(verdict).toEqual({
      ok: false,
      reason: "diff-not-attached",
      criterion: DIFF_FIRST_CRITERION,
    })
  })

  it("never blocks undeclared evidence — tightening only, never loosening", () => {
    expect(gradeRelease({})).toEqual({ ok: true })
    expect(gradeRelease({ evidence: {} })).toEqual({ ok: true })
    expect(gradeRelease({ evidence: undefined })).toEqual({ ok: true })
  })

  it("never blocks satisfied evidence", () => {
    expect(gradeRelease({ evidence: { diffAttached: true } })).toEqual({ ok: true })
  })
})

describe("RemoteApprovalGate diff-first release", () => {
  it("release refuses while the entry stays pending and the evidence stays immutable", () => {
    const gate = new RemoteApprovalGate({ enabled: true })
    const verdict = gate.submit("req-1", "allow", REMOTE, { diffAttached: false })
    expect(verdict.action).toBe("hold")

    const refused = gate.release("req-1", "127.0.0.1")
    expect(refused).toEqual({
      ok: false,
      reason: "diff-not-attached",
      criterion: DIFF_FIRST_CRITERION,
    })
    // The entry stays pending-gate; the held count did not increase.
    expect(gate.listPending()).toHaveLength(1)
    expect(gate.snapshot()).toMatchObject({ pending: 1, released: 0 })

    // Evidence is immutable (first answer wins): a repeat answer cannot
    // flip diffAttached to loosen the gate. The prompt must be answered
    // again with honest evidence (or times out deny).
    const repeat = gate.submit("req-1", "allow", REMOTE, { diffAttached: true })
    expect(repeat.action).toBe("hold")
    if (repeat.action === "hold") {
      expect(repeat.entry.evidence).toEqual({ diffAttached: false })
    }
  })

  it("undeclared evidence releases exactly as before", () => {
    const gate = new RemoteApprovalGate({ enabled: true })
    gate.submit("req-2", "allow", REMOTE)
    expect(gate.release("req-2", "127.0.0.1")).toMatchObject({ ok: true })
  })

  it("satisfied evidence releases", () => {
    const gate = new RemoteApprovalGate({ enabled: true })
    gate.submit("req-3", "allow", REMOTE, { diffAttached: true })
    expect(gate.release("req-3", "127.0.0.1")).toMatchObject({ ok: true })
  })
})

describe("diff-first gate route flow (mini Hono)", () => {
  function makeApp() {
    const gate = new RemoteApprovalGate({ enabled: true })
    const resolvePermission = vi.fn(() => true)
    const runtime = { resolvePermission, getPendingPermission: () => undefined }
    const app = new Hono()
    const perms = permissionsRoutes({ runtime, remoteApprovalGate: gate })
    const gateRoutes = approvalGateRoutes({ gate, runtime })
    app.post("/api/permissions/answer", (c) => perms.answer(c))
    app.post("/api/permissions/gate/release", (c) => gateRoutes.release(c))
    app.get("/api/permissions/gate/pending", (c) => gateRoutes.pending(c))
    return { app, gate, resolvePermission }
  }

  it("refuses the release of an answer that declared no diff, runtime untouched", async () => {
    const { app, resolvePermission } = makeApp()

    const answer = await app.request(
      "/api/permissions/answer",
      post({ requestId: "req-d1", decision: "allow", evidence: { diffAttached: false } }),
      envFor(REMOTE),
    )
    expect(answer.status).toBe(403) // held in pending-gate
    expect(resolvePermission).not.toHaveBeenCalled()

    const release = await app.request(
      "/api/permissions/gate/release",
      post({ requestId: "req-d1" }),
      envFor("127.0.0.1"),
    )
    expect(release.status).toBe(403)
    const body = (await release.json()) as { error: string; criterion: string; requestId: string }
    expect(body.error).toBe("diff_not_attached")
    expect(body.requestId).toBe("req-d1")
    expect(body.criterion).toBe(DIFF_FIRST_CRITERION)
    expect(resolvePermission).not.toHaveBeenCalled()

    const pending = await app.request("/api/permissions/gate/pending")
    const pendingBody = (await pending.json()) as {
      items: Array<{ requestId: string; evidence?: { diffAttached?: boolean } }>
    }
    expect(pendingBody.items).toHaveLength(1)
    expect(pendingBody.items[0]).toMatchObject({
      requestId: "req-d1",
      evidence: { diffAttached: false },
    })
  })

  it("releases normally when evidence was not declared or is satisfied", async () => {
    const { app, resolvePermission } = makeApp()

    const undeclared = await app.request(
      "/api/permissions/answer",
      post({ requestId: "req-d2", decision: "allow" }),
      envFor(REMOTE),
    )
    expect(undeclared.status).toBe(403)

    const release = await app.request(
      "/api/permissions/gate/release",
      post({ requestId: "req-d2" }),
      envFor("127.0.0.1"),
    )
    expect(release.status).toBe(200)
    expect(resolvePermission).toHaveBeenCalledWith("req-d2", "allow")

    const satisfied = await app.request(
      "/api/permissions/answer",
      post({ requestId: "req-d3", decision: "allow", evidence: { diffAttached: true } }),
      envFor(REMOTE),
    )
    expect(satisfied.status).toBe(403)
    const release3 = await app.request(
      "/api/permissions/gate/release",
      post({ requestId: "req-d3" }),
      envFor("127.0.0.1"),
    )
    expect(release3.status).toBe(200)
    expect(resolvePermission).toHaveBeenCalledWith("req-d3", "allow")
  })

  it("evidence on deny answers is never held (deny passes straight through)", async () => {
    const { app, gate, resolvePermission } = makeApp()
    const answer = await app.request(
      "/api/permissions/answer",
      post({ requestId: "req-deny", decision: "deny", evidence: { diffAttached: false } }),
      envFor(REMOTE),
    )
    expect(answer.status).toBe(200)
    expect(resolvePermission).toHaveBeenCalledWith("req-deny", "deny")
    expect(gate.listPending()).toHaveLength(0)
  })
})
