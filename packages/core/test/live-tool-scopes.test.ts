// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Live tool-scope tests (borrowing; MiniApps package-contract.md:156
 * "live switch" semantics).
 *
 * The tool scopes are re-read at EVERY definition listing and tool
 * execution instead of being baked in once per task:
 *   - a mid-run denylist change denies the NEXT call of the same tool
 *     with an explainable PermissionDeniedError (the tool loop surfaces
 *     it as a tool-end error — the agent adapts, nothing crashes);
 *   - the static setToolAllowlist/setToolDenylist stay the base; the
 *     live allow replaces, the live deny unions (fail-closed);
 *   - AgentRuntime.setWorkspaceToolDenylist mutates the override a
 *     running workspace's tool provider consults.
 */
import { describe, it, expect } from "vitest"
import type { Provider, ChatMessage, ChatResponse } from "@max/providers"
import { isPermissionDeniedError } from "@max/tools"
import { ToolEnabledProvider, createToolRegistry, runToolLoop } from "../src/tool-integration.js"
import { AgentRuntime, type RuntimeSink } from "../src/runtime.js"
import { Agent } from "../src/agent.js"
import type { AgentManifest, Plan, Result, Task, Workspace } from "../src/types.js"

// ── Provider-level: live scopes on the ToolEnabledProvider ─────────────────

class StubProvider implements Provider {
  id = "stub"
  name = "stub"
  defaultModel = "stub-1"
  isConfigured(): boolean {
    return true
  }
  async chat(): Promise<ChatResponse> {
    return {
      content: "",
      model: "stub-1",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    }
  }
  async *stream() {
    throw new Error("not used")
  }
}

function buildProvider(): ToolEnabledProvider {
  const registry = createToolRegistry()
  registry.register({
    echo: {
      name: "echo",
      kind: "misc",
      description: "echo",
      inputSchema: {},
      // The allowed-path assertions need a tool that actually settles.
      execute: async () => ({ ok: true }),
    } as never,
    read_file: { name: "read_file", kind: "read", description: "read", inputSchema: {} } as never,
  })
  return new ToolEnabledProvider(new StubProvider(), registry)
}

describe("live tool scopes on ToolEnabledProvider (borrowing)", () => {
  it("re-reads the denylist at execution time — next call of the same tool is denied", async () => {
    const p = buildProvider()
    let denied = false
    p.setLiveToolScopes(() => (denied ? { denied: ["echo"] } : undefined))

    // Before the change the call executes (the stub tool settles without
    // a real executor — an error result, NOT a permission denial).
    const before = await p.executeTool(
      { id: "c1", name: "echo", input: {} },
      { sessionID: "s", agent: "a", assistantMessageID: "m1" },
    )
    expect(isPermissionDeniedError(before.result)).toBe(false)

    // Mid-run change: the CURRENT scopes are re-read per call.
    denied = true
    await expect(
      p.executeTool(
        { id: "c2", name: "echo", input: {} },
        { sessionID: "s", agent: "a", assistantMessageID: "m2" },
      ),
    ).rejects.toThrow(/Permission denied: echo/)

    // Lifted again — the same tool executes on the next call.
    denied = false
    const after = await p.executeTool(
      { id: "c3", name: "echo", input: {} },
      { sessionID: "s", agent: "a", assistantMessageID: "m3" },
    )
    expect(isPermissionDeniedError(after.result)).toBe(false)
  })

  it("re-reads the allowlist at execution time and definition listing", async () => {
    const p = buildProvider()
    let allowed: string[] | undefined = undefined
    p.setLiveToolScopes(() => ({ allowed }))

    expect(p.getToolDefinitions().map((d) => d.name)).toEqual(["echo", "read_file"])

    // Restrict to echo only: read_file disappears from the tool list and
    // its execution is denied.
    allowed = ["echo"]
    expect(p.getToolDefinitions().map((d) => d.name)).toEqual(["echo"])
    await expect(
      p.executeTool(
        { id: "c1", name: "read_file", input: {} },
        { sessionID: "s", agent: "a", assistantMessageID: "m1" },
      ),
    ).rejects.toThrow(/Permission denied: read_file/)

    // Lift the allowlist: everything is visible and callable again.
    allowed = undefined
    expect(p.getToolDefinitions().map((d) => d.name)).toEqual(["echo", "read_file"])
  })

  it("merges with the static sets: live deny unions, live allow replaces", async () => {
    const p = buildProvider()
    p.setToolAllowlist(["echo", "read_file"])
    p.setToolDenylist(["read_file"])
    let liveDenied: string[] | undefined = undefined
    let liveAllowed: string[] | undefined = undefined
    p.setLiveToolScopes(() => ({ allowed: liveAllowed, denied: liveDenied }))

    // Static base: read_file denied.
    expect(p.getToolDefinitions().map((d) => d.name)).toEqual(["echo"])

    // Live deny unions with the static deny — echo disappears too.
    liveDenied = ["echo"]
    expect(p.getToolDefinitions().map((d) => d.name)).toEqual([])

    // Live deny lifted: back to the static base.
    liveDenied = undefined
    expect(p.getToolDefinitions().map((d) => d.name)).toEqual(["echo"])

    // Live allow REPLACES the static allow: only echo is allowed, and the
    // static deny still wins for read_file (fail-closed).
    liveAllowed = ["echo", "read_file"]
    expect(p.getToolDefinitions().map((d) => d.name)).toEqual(["echo"])
  })
})

// ── Runtime-level: setWorkspaceToolDenylist mid-run ────────────────────────

const STUB_MANIFEST: AgentManifest = {
  role: "general",
  displayName: "Stub",
  goal: "stub",
  systemPrompt: "stub",
}

/** Provider that reads twice; the test flips the denylist in between. */
function makeTwoReadProvider(file1: string, file2: string): Provider {
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
          content: `\`\`\`tool\n{"name":"read","input":{"path":${JSON.stringify(file1)}}}\n\`\`\``,
          model: "stub-1",
          usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
        }
      }
      if (calls === 2) {
        // The FIRST read succeeded — flip the live denylist NOW, before
        // the second read of the SAME tool executes.
        onSecondRound?.()
        return {
          content: `\`\`\`tool\n{"name":"read","input":{"path":${JSON.stringify(file2)}}}\n\`\`\``,
          model: "stub-1",
          usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
        }
      }
      const deniedSecond = messages.some((m) => m.content.includes("Permission denied"))
      return {
        content: deniedSecond ? "second-read-denied" : "second-read-allowed",
        model: "stub-1",
        usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
      }
    },

    async *stream() {
      throw new Error("not used")
    },
  }
}

let onSecondRound: (() => void) | undefined

class ToolLoopAgent extends Agent {
  override readonly manifest = STUB_MANIFEST
  override async execute(_task: Task, _ctx: unknown): Promise<Result> {
    throw new Error("not used — the tool loop path drives this agent")
  }
}

function makeSink(): RuntimeSink {
  return {
    saveWorkspace: async () => {},
    loadWorkspace: async () => undefined,
  }
}

function makeWorkspace(id: string): Workspace {
  const task: Task = {
    id: "t1",
    agentRole: "general",
    description: "read two files",
    status: "pending",
    dependsOn: [],
  }
  const plan: Plan = { id: `plan-${id}`, workspaceId: id, tasks: [task], edges: [] }
  return {
    id,
    userRequest: "read two files",
    status: "planning",
    plan,
    results: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: {},
  }
}

describe("AgentRuntime live tool denylist (borrowing)", () => {
  it("a mid-run denylist change denies the next same-tool call without crashing", async () => {
    const { promises: fs } = await import("node:fs")
    const path = await import("node:path")
    const os = await import("node:os")
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "livescopes-"))
    const file1 = path.join(dir, "first.txt")
    const file2 = path.join(dir, "second.txt")
    await fs.writeFile(file1, "first", "utf8")
    await fs.writeFile(file2, "second", "utf8")

    const { createPermissionedToolRegistry } = await import("../src/tool-integration.js")
    const registry = await createPermissionedToolRegistry()
    const workspace = makeWorkspace("ws-live-1")

    const runtime = new AgentRuntime(
      () => {
        const agent = new ToolLoopAgent()
        agent.setToolProvider(new ToolEnabledProvider(makeTwoReadProvider(file1, file2), registry))
        return agent
      },
      makeSink(),
      { enableToolLoop: true },
    )
    const wsId = workspace.id
    onSecondRound = () => {
      // The live switch: flips DURING the run, no task re-run.
      runtime.setWorkspaceToolDenylist(wsId, ["read"])
    }

    const final = await runtime.execute(workspace)
    onSecondRound = undefined

    // The run completed (no crash); the model's final reply proves the
    // second read was denied by the live scope while the first went
    // through.
    expect(final.status).toBe("completed")
    expect(final.results[0]?.output).toBe("second-read-denied")

    await fs.rm(dir, { recursive: true, force: true })
  })

  it("provider-level loop parity: denylist change surfaces as an explainable tool error", async () => {
    const { promises: fs } = await import("node:fs")
    const path = await import("node:path")
    const os = await import("node:os")
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "livescopes-loop-"))
    const file1 = path.join(dir, "first.txt")
    const file2 = path.join(dir, "second.txt")
    await fs.writeFile(file1, "first", "utf8")
    await fs.writeFile(file2, "second", "utf8")

    const { createPermissionedToolRegistry } = await import("../src/tool-integration.js")
    const registry = await createPermissionedToolRegistry()
    const provider = new ToolEnabledProvider(makeTwoReadProvider(file1, file2), registry)
    onSecondRound = () => {
      provider.setToolDenylist(["read"])
    }

    const { response } = await runToolLoop(provider, [{ role: "user", content: "read both" }])
    onSecondRound = undefined
    expect(response.content).toBe("second-read-denied")

    await fs.rm(dir, { recursive: true, force: true })
  })
})
