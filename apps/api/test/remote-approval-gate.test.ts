// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Remote approval gate tests (oh-my-claudecode borrowing):
 *   - loopback classification (IPv4, IPv6, mapped, unix-socket absence).
 *   - the pure gate: remote "allow" held, loopback/deny/disabled pass,
 *     first decision wins, release is loopback-only and one-shot,
 *     overflow evicts the oldest pending entry.
 *   - route flow through a mini Hono app: remote answer → structured 403
 *     hold (runtime untouched), loopback release → 200 + runtime resolved
 *     with the held decision; pending listing reflects all states.
 */

import { describe, it, expect, vi } from "vitest"
import { Hono } from "hono"
import {
  RemoteApprovalGate,
  isLoopbackAddress,
  requestRemoteAddress,
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

describe("isLoopbackAddress", () => {
  it("treats loopback spellings and absent sockets as local", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true)
    expect(isLoopbackAddress("::1")).toBe(true)
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true)
    expect(isLoopbackAddress("127.64.3.9")).toBe(true)
    expect(isLoopbackAddress(undefined)).toBe(true)
    expect(isLoopbackAddress("")).toBe(true)
  })

  it("treats other addresses as remote", () => {
    expect(isLoopbackAddress("10.0.0.5")).toBe(false)
    expect(isLoopbackAddress("192.168.1.7")).toBe(false)
    expect(isLoopbackAddress("::ffff:10.0.0.5")).toBe(false)
    expect(isLoopbackAddress("::2")).toBe(false)
  })
})

describe("requestRemoteAddress", () => {
  it("reads the node-server socket shape and tolerates its absence", () => {
    const c = { env: envFor("9.9.9.9") } as never
    expect(requestRemoteAddress(c)).toBe("9.9.9.9")
    expect(requestRemoteAddress({ env: {} } as never)).toBeUndefined()
    expect(requestRemoteAddress({} as never)).toBeUndefined()
  })
})

describe("RemoteApprovalGate", () => {
  it("holds remote allow answers and records them once", () => {
    const gate = new RemoteApprovalGate({ enabled: true })
    const first = gate.submit("req-1", "allow", REMOTE)
    expect(first).toMatchObject({ action: "hold" })
    if (first.action === "hold") {
      expect(first.entry).toMatchObject({
        requestId: "req-1",
        decision: "allow",
        status: "pending-gate",
      })
    }
    // Re-submission must not mutate the held decision.
    const again = gate.submit("req-1", "allow", "198.51.100.2")
    expect(again.action === "hold" && again.entry.remoteAddress).toBe(REMOTE)
    expect(gate.listPending()).toHaveLength(1)
    expect(gate.snapshot()).toMatchObject({ pending: 1, held: 1, released: 0, expired: 0 })
  })

  it("passes loopback, deny, and disabled-gate answers through", () => {
    const gate = new RemoteApprovalGate({ enabled: true })
    expect(gate.submit("r1", "allow", "127.0.0.1")).toEqual({ action: "pass" })
    expect(gate.submit("r2", "allow", undefined)).toEqual({ action: "pass" })
    expect(gate.submit("r3", "deny", REMOTE)).toEqual({ action: "pass" })
    const off = new RemoteApprovalGate({ enabled: false })
    expect(off.submit("r4", "allow", REMOTE)).toEqual({ action: "pass" })
    expect(gate.snapshot().pending).toBe(0)
  })

  it("releases only from loopback and only once", () => {
    const gate = new RemoteApprovalGate({ enabled: true })
    gate.submit("req-9", "allow", REMOTE)

    expect(gate.release("req-9", REMOTE)).toEqual({ ok: false, reason: "remote-release-forbidden" })
    expect(gate.release("nope")).toEqual({ ok: false, reason: "unknown" })

    const released = gate.release("req-9")
    expect(released.ok).toBe(true)
    if (released.ok) expect(released.entry.status).toBe("released")

    expect(gate.release("req-9")).toEqual({ ok: false, reason: "already-released" })
    expect(gate.listPending()).toHaveLength(0)
    expect(gate.snapshot()).toMatchObject({ held: 1, released: 1 })
  })

  it("evicts the oldest pending entry past the registry bound", () => {
    const gate = new RemoteApprovalGate({ enabled: true })
    for (let i = 0; i < 1000; i++) gate.submit(`req-${i}`, "allow", REMOTE)
    gate.submit("req-overflow", "allow", REMOTE)
    expect(gate.snapshot()).toMatchObject({ pending: 1000, expired: 1 })
    expect(gate.release("req-0")).toEqual({ ok: false, reason: "unknown" })
    expect(gate.release("req-999").ok).toBe(true)
  })

  it("uses an injectable clock", () => {
    const gate = new RemoteApprovalGate({ enabled: true, now: () => "2026-01-02T03:04:05.000Z" })
    const verdict = gate.submit("r", "allow", REMOTE)
    expect(verdict.action === "hold" && verdict.entry.requestedAt).toBe("2026-01-02T03:04:05.000Z")
  })
})

describe("approval gate routes", () => {
  function buildApp(gate: RemoteApprovalGate) {
    const app = new Hono()
    const resolvePermission = vi.fn(() => true)
    const runtime = { resolvePermission }
    const perm = permissionsRoutes({ runtime, remoteApprovalGate: gate })
    const gateRoutes = approvalGateRoutes({ gate, runtime })
    app.post("/api/permissions/answer", perm.answer)
    app.post("/api/permissions/gate/release", gateRoutes.release)
    app.get("/api/permissions/gate/pending", gateRoutes.pending)
    return { app, resolvePermission }
  }

  it("holds a remote allow with a structured 403 and resolves nothing", async () => {
    const { app, resolvePermission } = buildApp(new RemoteApprovalGate({ enabled: true }))
    const res = await app.request(
      "/api/permissions/answer",
      post({ requestId: "req-1", decision: "allow" }),
      envFor(REMOTE),
    )
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({
      error: "remote_approval_gate_pending",
      requestId: "req-1",
      gateState: "pending-gate",
    })
    expect(resolvePermission).not.toHaveBeenCalled()
  })

  it("lets remote deny and loopback allow through unchanged", async () => {
    const { app, resolvePermission } = buildApp(new RemoteApprovalGate({ enabled: true }))
    const deny = await app.request(
      "/api/permissions/answer",
      post({ requestId: "req-d", decision: "deny" }),
      envFor(REMOTE),
    )
    expect(deny.status).toBe(200)
    expect(resolvePermission).toHaveBeenCalledWith("req-d", "deny")

    const localAllow = await app.request(
      "/api/permissions/answer",
      post({ requestId: "req-l", decision: "allow" }),
      envFor("127.0.0.1"),
    )
    expect(localAllow.status).toBe(200)
    expect(resolvePermission).toHaveBeenCalledWith("req-l", "allow")
  })

  it("releases a held answer from loopback and applies the held decision", async () => {
    const { app, resolvePermission } = buildApp(new RemoteApprovalGate({ enabled: true }))
    await app.request(
      "/api/permissions/answer",
      post({ requestId: "req-2", decision: "allow" }),
      envFor(REMOTE),
    )

    // Remote release refused.
    const refused = await app.request(
      "/api/permissions/gate/release",
      post({ requestId: "req-2" }),
      envFor(REMOTE),
    )
    expect(refused.status).toBe(403)
    expect(resolvePermission).not.toHaveBeenCalled()

    // Pending listing shows the held entry.
    const pending = await app.request(
      "/api/permissions/gate/pending",
      { method: "GET" },
      envFor("127.0.0.1"),
    )
    const pendingBody = (await pending.json()) as {
      items: Array<{ requestId: string; status: string }>
      snapshot: { pending: number }
    }
    expect(pendingBody.items.map((i) => i.requestId)).toEqual(["req-2"])
    expect(pendingBody.snapshot.pending).toBe(1)

    // Loopback release applies the decision.
    const released = await app.request(
      "/api/permissions/gate/release",
      post({ requestId: "req-2" }),
      envFor("127.0.0.1"),
    )
    expect(released.status).toBe(200)
    expect(await released.json()).toMatchObject({
      requestId: "req-2",
      decision: "allow",
      gate: "released",
    })
    expect(resolvePermission).toHaveBeenCalledWith("req-2", "allow")

    // Second release is a structured 404; pending is empty.
    const again = await app.request(
      "/api/permissions/gate/release",
      post({ requestId: "req-2" }),
      envFor("127.0.0.1"),
    )
    expect(again.status).toBe(404)
    expect(((await again.json()) as { error: string }).error).toBe("already-released")
    const after = (await (
      await app.request("/api/permissions/gate/pending", { method: "GET" })
    ).json()) as { items: unknown[]; snapshot: { released: number; pending: number } }
    expect(after.items).toHaveLength(0)
    expect(after.snapshot).toMatchObject({ released: 1, pending: 0 })
  })

  it("answers an unknown release with 404 and honors a disabled gate", async () => {
    const { app, resolvePermission } = buildApp(new RemoteApprovalGate({ enabled: true }))
    const unknown = await app.request(
      "/api/permissions/gate/release",
      post({ requestId: "ghost" }),
      envFor("127.0.0.1"),
    )
    expect(unknown.status).toBe(404)
    expect(resolvePermission).not.toHaveBeenCalled()

    const off = buildApp(new RemoteApprovalGate({ enabled: false }))
    const passthrough = await off.app.request(
      "/api/permissions/answer",
      post({ requestId: "req-3", decision: "allow" }),
      envFor(REMOTE),
    )
    expect(passthrough.status).toBe(200)
    expect(off.resolvePermission).toHaveBeenCalledWith("req-3", "allow")
  })
})
