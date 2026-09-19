// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Permission-gated tool loop end-to-end smoke (minimax-code borrowing) and
 * runtime permission-service paths (always-rule auto-approval, fail-closed
 * timeout, allow-always).
 */
import { describe, it, expect } from "vitest"
import { promises as fs } from "node:fs"
import path from "node:path"
import os from "node:os"
import type { Provider, ChatMessage, ChatResponse } from "@max/providers"
import {
  ToolEnabledProvider,
  createPermissionedToolRegistry,
  runToolLoop,
} from "../src/tool-integration.js"
import { AgentRuntime, type RuntimeSink } from "../src/runtime.js"
import type { Workspace, Result, Task } from "../src/types.js"

/** Provider that issues one ```tool``` read call, then finishes. */
function makeReadToolProvider(content: string, target: string): Provider {
  let calls = 0
  return {
    id: "stub",
    name: "Stub",
    defaultModel: "stub-1",
    isConfigured: () => true,
    async chat(messages: ChatMessage[]): Promise<ChatResponse> {
      calls += 1
      if (calls === 1) {
        return {
          content: `\`\`\`tool\n{"name":"read","input":{"path":${JSON.stringify(target)}}}\n\`\`\``,
          model: "stub-1",
          usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
        }
      }
      // The tool result is appended as a user message — verify the model
      // actually saw the file content, then finish.
      const sawFile = messages.some((m) => m.content.includes(content))
      return {
        content: sawFile ? `saw:${content}` : "did not see file",
        model: "stub-1",
        usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
      }
    },
    // eslint-disable-next-line require-yield
    async *stream() {
      throw new Error("not used")
    },
  }
}

describe("permission-gated tool loop (e2e smoke)", () => {
  it("executes an allowed read tool through the permissioned registry", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "toolloop-"))
    const file = path.join(dir, "notes.txt")
    await fs.writeFile(file, "hello-from-toolloop", "utf8")

    const registry = await createPermissionedToolRegistry()
    const provider = new ToolEnabledProvider(
      makeReadToolProvider("hello-from-toolloop", file),
      registry,
    )
    const { response } = await runToolLoop(provider, [{ role: "user", content: "read the file" }])
    // read is "allow" by default for non-secret paths, so no permission
    // prompt — the model should have seen the content.
    expect(response.content).toBe("saw:hello-from-toolloop")
    await fs.rm(dir, { recursive: true, force: true })
  })

  it("denies a secret path outright (permission deny pattern)", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "toolloop-"))
    const envFile = path.join(dir, ".env")
    await fs.writeFile(envFile, "SECRET=1", "utf8")

    const registry = await createPermissionedToolRegistry()
    const provider = new ToolEnabledProvider(makeReadToolProvider("SECRET=1", envFile), registry)
    const { response } = await runToolLoop(provider, [{ role: "user", content: "read .env" }])
    // .env matches the deny pattern — the tool result must be an error, so
    // the model never sees the secret.
    expect(response.content).toBe("did not see file")
    await fs.rm(dir, { recursive: true, force: true })
  })
})

// ── Runtime permission-service paths ─────────────────────────────────────────

function makeSink(): RuntimeSink {
  return {
    saveWorkspace: async () => {},
    loadWorkspace: async () => undefined,
  }
}

describe("AgentRuntime permission service paths", () => {
  it("resolves allow-always, then auto-approves a matching ask", async () => {
    const runtime = new AgentRuntime(() => undefined, makeSink(), {})
    const meta = { workspaceId: "ws-1", taskId: "t-1", tool: "bash", target: "npm test" }
    const first = runtime.awaitPermission(`req-1`, meta)
    expect(runtime.resolvePermission("req-1", "allow-always")).toBe(true)
    await expect(first).resolves.toBe("allow")

    // Second matching ask: the always-rule approves instantly — the parked
    // user channel is cleared without any human action.
    const second = runtime.awaitPermission("req-2", { ...meta, taskId: "t-2" })
    await expect(second).resolves.toBe("allow")
    // A stale answer for the auto-approved prompt finds no pending entry.
    expect(runtime.resolvePermission("req-2", "deny")).toBe(false)
    // The service retains the rule.
    expect(runtime.getPermissionService("ws-1").listAlwaysPatterns()).toHaveLength(1)
  })

  it("fails closed on timeout (unanswered ask never approves)", async () => {
    const runtime = new AgentRuntime(() => undefined, makeSink(), { permissionAskTimeoutMs: 30 })
    const pending = runtime.awaitPermission("req-t", {
      workspaceId: "ws-2",
      taskId: "t-1",
      tool: "bash",
      target: "rm -rf /",
    })
    await expect(pending).resolves.toBe("deny")
    // A late answer finds nothing pending.
    expect(runtime.resolvePermission("req-t", "allow")).toBe(false)
  })

  it("reject decision resolves deny and batch-rejects a matching ask", async () => {
    const runtime = new AgentRuntime(() => undefined, makeSink(), {})
    const meta = { workspaceId: "ws-3", taskId: "t-1", tool: "bash", target: "curl evil" }
    const first = runtime.awaitPermission("req-a", meta)
    const second = runtime.awaitPermission("req-b", { ...meta, taskId: "t-2" })
    expect(runtime.resolvePermission("req-a", "deny")).toBe(true)
    await expect(first).resolves.toBe("deny")
    // Same target → the reject swept the matching pending ask too.
    await expect(second).resolves.toBe("deny")
  })
})

// Keep the imports referenced for lint (Workspace/Result/Task used in types only).
export type { Workspace, Result, Task }

describe("AgentRuntime auto-review mode (deepseek borrowing)", () => {
  const meta = { workspaceId: "ws-ar", taskId: "t-ar", tool: "bash", target: "npm publish" }

  it("auto-allows when the reviewer returns a legal low/allow verdict", async () => {
    const runtime = new AgentRuntime(() => undefined, makeSink(), {
      autoReviewer: async () => ({ risk: "low", decision: "allow", reason: "routine cleanup" }),
    })
    await expect(runtime.awaitPermission("ar-1", meta)).resolves.toBe("allow")
    // Every subsequent legal low/allow verdict auto-approves too.
    await expect(runtime.awaitPermission("ar-2", meta)).resolves.toBe("allow")
  })

  it("fails closed on reviewer errors and illegal verdicts", async () => {
    const runtime = new AgentRuntime(() => undefined, makeSink(), {
      autoReviewer: async () => {
        throw new Error("reviewer exploded")
      },
    })
    await expect(runtime.awaitPermission("ar-3", meta)).resolves.toBe("deny")
  })

  it("high-risk verdicts always deny", async () => {
    const runtime = new AgentRuntime(() => undefined, makeSink(), {
      autoReviewer: async () => ({ risk: "high", decision: "allow", reason: "trust me" }),
    })
    await expect(runtime.awaitPermission("ar-4", meta)).resolves.toBe("deny")
  })
})
