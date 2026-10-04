// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Workspace stop route + integrity admin route tests:
 *   - stop: tenant-scoped 404, runtime.abort called with the reason, stop
 *     signal published to the worker channel, audit entry appended.
 *   - integrity: audit verify passthrough (ok + tampered), shadow list /
 *     create / rollback with ShadowCommitError → HTTP status mapping.
 *
 * Handlers are invoked with hand-built contexts (param/json validators
 * stubbed) — the OpenAPI layer itself is exercised by the contract
 * snapshot test. Real AuditLedger on a tmpdir, real git repo for the
 * shadow lifecycle, no Redis (publisher is injected).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { AuditLedger, ShadowCommitError } from "@max/workspace"
import type { Workspace } from "@max/core"
import { stopWorkspace, type WorkspaceStopPort } from "../src/routes/workspace.js"
import { verifyAudit, listShadow, createShadow, rollbackShadow } from "../src/routes/integrity.js"

type FakeContext = {
  status?: number
  data?: unknown
  json: (data: unknown, status?: number) => { data: unknown; status?: number }
}

function makeContext(params: { id?: string; tenantId?: string; body?: unknown }): {
  c: never
  res: FakeContext
} {
  const res: FakeContext = {
    json: (data, status) => {
      res.data = data
      res.status = status
      return { data, status }
    },
  }
  const c = {
    req: {
      valid: (t: string) => (t === "param" ? { id: params.id } : params.body),
    },
    get: (key: string) => (key === "tenantId" ? params.tenantId : undefined),
    json: res.json,
  }
  return { c: c as never, res }
}

function makeWorkspace(id: string, tenantId?: string): Workspace {
  return {
    id,
    userRequest: `request for ${id}`,
    status: "executing",
    results: [],
    createdAt: "2026-10-05T00:00:00.000Z",
    updatedAt: "2026-10-05T00:00:00.000Z",
    metadata: tenantId !== undefined ? { tenantId } : {},
  }
}

function storeWith(workspaces: Workspace[], tenants: Record<string, string> = {}) {
  return {
    loadWorkspace: async (id: string, tenantId?: string) => {
      const ws = workspaces.find((w) => w.id === id)
      if (!ws) return undefined
      const stored = tenants[id] ?? ""
      if (tenantId !== undefined) return stored === tenantId ? ws : undefined
      return stored === "" ? ws : undefined
    },
  }
}

describe("POST /workspaces/:id/stop", () => {
  let auditFile: string
  let audit: AuditLedger

  beforeEach(async () => {
    auditFile = path.join(await fs.mkdtemp(path.join(tmpdir(), "max-stop-")), "audit.jsonl")
    audit = new AuditLedger(auditFile)
  })

  afterEach(async () => {
    await fs.rm(path.dirname(auditFile), { recursive: true, force: true })
  })

  it("aborts the runtime, publishes the signal, and audits the stop", async () => {
    const runtime: WorkspaceStopPort = { abort: vi.fn() }
    const publish = vi.fn(async () => {})
    const { c, res } = makeContext({ id: "ws-1", body: { reason: "user asked" } })
    const out = await stopWorkspace({
      store: storeWith([makeWorkspace("ws-1")]) as never,
      runtime,
      redisUrl: "redis://fake",
      audit,
      publish,
    })(c)
    expect(out.data).toEqual({ ok: true, workspaceId: "ws-1" })
    expect(runtime.abort).toHaveBeenCalledWith("ws-1", "user asked")
    expect(publish).toHaveBeenCalledWith("redis://fake", {
      workspaceId: "ws-1",
      reason: "user asked",
      source: "api",
    })
    expect(await audit.verify()).toMatchObject({ ok: true, entries: 1 })
    expect(res.status).toBeUndefined() // 200 default — no explicit status
  })

  it("defaults the reason and works without redis/audit wiring", async () => {
    const runtime: WorkspaceStopPort = { abort: vi.fn() }
    const { c } = makeContext({ id: "ws-2" })
    const out = await stopWorkspace({
      store: storeWith([makeWorkspace("ws-2")]) as never,
      runtime,
    })(c)
    expect(out.data).toEqual({ ok: true, workspaceId: "ws-2" })
    expect(runtime.abort).toHaveBeenCalledWith("ws-2", "user stop")
  })

  it("404s for unknown ids and for tenant-mismatched ids", async () => {
    const runtime: WorkspaceStopPort = { abort: vi.fn() }
    const missing = makeContext({ id: "ws-missing" })
    await stopWorkspace({ store: storeWith([]) as never, runtime })(missing.c)
    expect(missing.res.status).toBe(404)

    const mismatched = makeContext({ id: "ws-3", tenantId: "tenant-b" })
    await stopWorkspace({
      store: storeWith([makeWorkspace("ws-3")], { "ws-3": "tenant-a" }) as never,
      runtime,
    })(mismatched.c)
    expect(mismatched.res.status).toBe(404)
    expect(runtime.abort).not.toHaveBeenCalled()
  })
})

describe("integrity admin handlers", () => {
  let dir: string
  let auditFile: string
  let audit: AuditLedger

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(tmpdir(), "max-integrity-"))
    auditFile = path.join(dir, "audit.jsonl")
    audit = new AuditLedger(auditFile)
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  async function jsonHandler<T>(fn: (c: never) => unknown, body: unknown): Promise<T> {
    const c = {
      req: { valid: () => body },
      json: (data: unknown, status?: number) => ({ data, status }),
    }
    return (await fn(c as never)) as T
  }

  async function initRepo(): Promise<string> {
    const root = await fs.mkdtemp(path.join(tmpdir(), "max-shadow-"))
    const repo = path.join(root, "repo")
    await fs.mkdir(repo)
    execFileSync("git", ["init", "-q"], { cwd: repo })
    execFileSync("git", ["config", "user.email", "t@t"], { cwd: repo })
    execFileSync("git", ["config", "user.name", "t"], { cwd: repo })
    await fs.writeFile(path.join(repo, "f.txt"), "one")
    execFileSync("git", ["add", "-A"], { cwd: repo })
    execFileSync("git", ["commit", "-qm", "init"], { cwd: repo })
    return repo
  }

  it("verify reports the ledger chain health", async () => {
    await audit.append("permission.allowed", { requestId: "r1" })
    const ok = await jsonHandler<{ data: { ok: boolean; entries: number } }>(
      verifyAudit({ audit }),
      {},
    )
    expect(ok.data).toMatchObject({ ok: true, entries: 1 })

    // Corrupt the chain by rewriting a payload in place.
    const raw = await fs.readFile(auditFile, "utf8")
    await fs.writeFile(auditFile, raw.replace('"r1"', '"tampered"'), "utf8")
    const bad = await jsonHandler<{ data: { ok: boolean } }>(verifyAudit({ audit }), {})
    expect(bad.data.ok).toBe(false)
  })

  it("verify 503s when no ledger is configured", async () => {
    const res = await jsonHandler<{ data: unknown; status?: number }>(
      verifyAudit({ repoDir: dir }),
      {},
    )
    expect(res.status).toBe(503)
  })

  it("shadow lifecycle: create → list → rollback (with dirty/force mapping)", async () => {
    const repo = await initRepo()

    const created = await jsonHandler<{ data: { ok: boolean; shadow: { id: string } } }>(
      createShadow({ repoDir: repo, audit }),
      { label: "test" },
    )
    expect(created.data.ok).toBe(true)

    const listed = await jsonHandler<{ data: { shadows: { id: string }[] } }>(
      listShadow({ repoDir: repo }),
      {},
    )
    expect(listed.data.shadows).toHaveLength(1)
    expect(created.data.shadow.id).toBe(listed.data.shadows[0]!.id)

    // Dirty worktree refuses without force (409), content untouched.
    await fs.writeFile(path.join(repo, "f.txt"), "two")
    const dirty = await jsonHandler<{ data: { code?: string }; status?: number }>(
      rollbackShadow({ repoDir: repo, audit }),
      { id: listed.data.shadows[0]!.id },
    )
    expect(dirty.status).toBe(409)
    expect(dirty.data.code).toBe("dirty-worktree")
    expect(await fs.readFile(path.join(repo, "f.txt"), "utf8")).toBe("two")

    const forced = await jsonHandler<{ data: { ok: boolean } }>(
      rollbackShadow({ repoDir: repo, audit }),
      { id: listed.data.shadows[0]!.id, force: true },
    )
    expect(forced.data.ok).toBe(true)
    expect(await fs.readFile(path.join(repo, "f.txt"), "utf8")).toBe("one")

    // Audit trail holds create + rollback events and still verifies.
    const actions = (await fs.readFile(auditFile, "utf8"))
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => (JSON.parse(l) as { action: string }).action)
    expect(actions).toContain("shadow.commit")
    expect(actions).toContain("shadow.rollback")
    expect(await audit.verify()).toMatchObject({ ok: true })
  })

  it("rollback maps unknown-id to 404", async () => {
    const repo = await initRepo()
    const missing = await jsonHandler<{ data: { code?: string }; status?: number }>(
      rollbackShadow({ repoDir: repo, audit }),
      { id: "deadbeef" },
    )
    expect(missing.status).toBe(404)
    expect(missing.data.code).toBe("unknown-id")
  })

  it("create surfaces not-a-repo as 409", async () => {
    const res = await jsonHandler<{ data: { code?: string }; status?: number }>(
      createShadow({ repoDir: dir, audit }),
      { label: "x" },
    )
    expect(res.status).toBe(409)
    expect(res.data.code).toBe("not-a-repo")
  })

  it("ShadowCommitError carries the code the route maps", () => {
    const err = new ShadowCommitError("dirty-worktree", "refuses")
    expect(err.code).toBe("dirty-worktree")
  })
})
