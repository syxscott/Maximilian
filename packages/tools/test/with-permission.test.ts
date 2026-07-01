/**
 * Tests for the withPermission runtime gate.
 *
 * Strategy: build a fake `Materialization` (definitions + settle) and verify
 * the wrapper routes calls through to it, throws the right error class for
 * deny/ask, and never silently bypasses a deny.
 */

import { describe, it, expect } from "vitest"
import {
  withPermission,
  PermissionRequestError,
  PermissionDeniedError,
  isPermissionRequestError,
  isPermissionDeniedError,
  type PermissionProvider,
} from "../src/with-permission"
import {
  DEFAULT_PERMISSIONS,
  type Permissions,
  type ToolName,
} from "../src/permission"
import type { Materialization, ExecuteInput, Settlement } from "../src/registry"

// ── Test helpers ─────────────────────────────────────────────────────────

function makeMaterialization(behaviour: "allow" | "echo" | "fail" = "echo"): Materialization & {
  calls: ExecuteInput[]
} {
  const calls: ExecuteInput[] = []
  return {
    calls,
    definitions: [],
    async settle(input: ExecuteInput): Promise<Settlement> {
      calls.push(input)
      if (behaviour === "fail") {
        throw new Error("inner failure")
      }
      if (behaviour === "allow") {
        return { result: { ok: true } }
      }
      return { result: { echoed: input.call.input } }
    },
  }
}

const ask: Permissions = {
  defaults: { bash: "ask", write: "ask", edit: "ask", read: "ask", glob: "ask", grep: "ask" },
  patterns: {},
}
const allow: Permissions = {
  defaults: { bash: "allow", write: "allow", edit: "allow", read: "allow", glob: "allow", grep: "allow" },
  patterns: {},
}
const deny: Permissions = {
  defaults: { bash: "deny", write: "deny", edit: "deny", read: "deny", glob: "deny", grep: "deny" },
  patterns: {},
}

function call(name: ToolName, input: unknown, id = "call-1"): ExecuteInput {
  return {
    sessionID: "s1",
    agent: "tester",
    assistantMessageID: "m1",
    call: { id, name, input },
  }
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("withPermission", () => {
  it("passes through when default is allow", async () => {
    const inner = makeMaterialization()
    const gate = withPermission(inner, allow)
    const out = await gate.settle(call("read", { path: "/etc/hosts" }))
    expect(out.result).toEqual({ echoed: { path: "/etc/hosts" } })
    expect(inner.calls).toHaveLength(1)
  })

  it("throws PermissionDeniedError when default is deny", async () => {
    const inner = makeMaterialization()
    const gate = withPermission(inner, deny)
    await expect(gate.settle(call("bash", { command: "ls" }))).rejects.toBeInstanceOf(
      PermissionDeniedError,
    )
    expect(inner.calls).toHaveLength(0)
  })

  it("throws PermissionRequestError when default is ask", async () => {
    const inner = makeMaterialization()
    const gate = withPermission(inner, ask)
    let caught: unknown
    try {
      await gate.settle(call("write", { path: "/tmp/a", content: "x" }))
    } catch (e) {
      caught = e
    }
    expect(isPermissionRequestError(caught)).toBe(true)
    expect(caught).toBeInstanceOf(PermissionRequestError)
    if (caught instanceof PermissionRequestError) {
      expect(caught.tool).toBe("write")
      expect(caught.target).toBe("/tmp/a")
      expect(caught.callId).toBe("call-1")
      expect(caught.requestId).toMatch(/^prq_/)
    }
    expect(inner.calls).toHaveLength(0)
  })

  it("uses per-tool defaults correctly", async () => {
    const cfg: Permissions = {
      defaults: {
        bash: "ask",
        write: "deny",
        edit: "ask",
        read: "allow",
        glob: "allow",
        grep: "allow",
      },
      patterns: {},
    }
    const inner = makeMaterialization()
    const gate = withPermission(inner, cfg)

    // read → allow
    await gate.settle(call("read", { path: "/x" }))
    // write → deny
    await expect(gate.settle(call("write", { path: "/x" }))).rejects.toBeInstanceOf(
      PermissionDeniedError,
    )
    // bash → ask
    await expect(gate.settle(call("bash", { command: "ls" }))).rejects.toBeInstanceOf(
      PermissionRequestError,
    )
    expect(inner.calls).toHaveLength(1) // only the allowed read reached the inner
  })

  it("pattern overrides win over default", async () => {
    const cfg: Permissions = {
      ...DEFAULT_PERMISSIONS,
      patterns: { write: { "/tmp/**": "allow" } },
    }
    const inner = makeMaterialization()
    const gate = withPermission(inner, cfg)

    await gate.settle(call("write", { path: "/tmp/foo", content: "x" }))
    await expect(
      gate.settle(call("write", { path: "/etc/passwd", content: "x" })),
    ).rejects.toBeInstanceOf(PermissionRequestError)
    expect(inner.calls).toHaveLength(1)
  })

  it("accepts a function provider that resolves config lazily", async () => {
    let mutable: Permissions = deny
    const provider: PermissionProvider = () => mutable
    const inner = makeMaterialization()
    const gate = withPermission(inner, provider)

    await expect(gate.settle(call("read", { path: "/x" }))).rejects.toBeInstanceOf(
      PermissionDeniedError,
    )

    mutable = allow
    await gate.settle(call("read", { path: "/x" }))
    expect(inner.calls).toHaveLength(1) // only the second
  })

  it("accepts an async provider", async () => {
    const provider: PermissionProvider = async () => allow
    const inner = makeMaterialization()
    const gate = withPermission(inner, provider)
    await gate.settle(call("bash", { command: "ls" }))
    expect(inner.calls).toHaveLength(1)
  })

  it("unknown tool names pass through to inner executor", async () => {
    const inner = makeMaterialization("fail")
    const gate = withPermission(inner, deny)
    // not a real tool — wrapper should not throw a permission error
    await expect(
      gate.settle({
        sessionID: "s",
        agent: "a",
        assistantMessageID: "m",
        call: { id: "c", name: "unknown-tool", input: {} },
      }),
    ).rejects.toThrow("inner failure")
  })

  it("definitions are passed through unchanged", () => {
    const inner: Materialization = {
      definitions: [{ name: "read", description: "", inputSchema: { type: "object" } } as any],
      async settle() { return { result: null } }
    }
    const gate = withPermission(inner, allow)
    expect(gate.definitions).toBe(inner.definitions)
  })
})

describe("type guards", () => {
  it("distinguishes request vs denied", () => {
    const req = new PermissionRequestError({ tool: "write", target: "/x", callId: "c", requestId: "r" })
    const den = new PermissionDeniedError({ tool: "write", target: "/x", callId: "c" })
    expect(isPermissionRequestError(req)).toBe(true)
    expect(isPermissionRequestError(den)).toBe(false)
    expect(isPermissionDeniedError(den)).toBe(true)
    expect(isPermissionDeniedError(req)).toBe(false)
  })
})
