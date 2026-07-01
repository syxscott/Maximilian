/**
 * Integration test: a tool gated by `withPermission("ask", ...)` parks the
 * tool loop until the runtime's `resolvePermission` is called, then re-runs
 * the same call against the (now-allowed) config and the workspace
 * completes.
 *
 * Uses the real `read` tool so the call goes through the permission gate
 * (the gate only intercepts the 6 known tool names: bash, read, write,
 * edit, glob, grep).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { AgentRuntime, type RuntimeEvent } from "../src/runtime.js"
import { Agent, type AgentContext } from "../src/agent.js"
import {
  ToolEnabledProvider,
  createToolRegistry,
} from "../src/tool-integration.js"
import {
  withPermission,
  type Materialization,
  readTool,
  type ExecuteInput,
} from "@max/tools"
import {
  DEFAULT_PERMISSIONS,
  type Permissions,
} from "@max/tools/permission"
import type { AgentManifest, Plan, Result, Task, Workspace } from "../src/types.js"
import type { Provider, ChatMessage, ChatResponse } from "@max/providers"

const MANIFEST: AgentManifest = {
  role: "general",
  displayName: "Gated",
  goal: "x",
  systemPrompt: "x",
}

class ToolIssuingReadProvider implements Provider {
  id = "stub"
  name = "stub"
  defaultModel = "stub"
  isConfigured(): boolean { return true }
  async chat(_messages: ChatMessage[]): Promise<ChatResponse> {
    return {
      content: "```tool\n{\"name\":\"read\",\"input\":{\"path\":\"REPLACE\"}}\n```",
      model: "stub",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    }
  }
  async *stream() { /* noop */ }
}

class GatedAgent extends Agent {
  override readonly manifest = MANIFEST
  private readonly toolProvider: ToolEnabledProvider
  constructor(toolProvider: ToolEnabledProvider) {
    super(new ToolIssuingReadProvider())
    this.toolProvider = toolProvider
  }
  override getToolProvider(): ToolEnabledProvider | undefined {
    return this.toolProvider
  }
  override async execute(_task: Task, _ctx: AgentContext): Promise<Result> {
    return { id: "x", taskId: _task.id, agentRole: "general", output: "x" }
  }
}

function makeWorkspace(id: string): Workspace {
  const tasks: Task[] = [
    { id: "t1", description: "x", agentRole: "general", dependsOn: [], status: "pending" },
  ]
  const plan: Plan = { tasks, edges: [] }
  return {
    id,
    userRequest: "x",
    plan,
    results: [],
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function makeSink() {
  return {
    workspaces: new Map<string, Workspace>(),
    async saveWorkspace(w: Workspace) { this.workspaces.set(w.id, w) },
    async loadWorkspace(id: string) { return this.workspaces.get(id) },
  }
}

describe("Tool loop with permission gate (read tool)", () => {
  let tmpDir: string
  let filePath: string
  let config: Permissions

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "max-perm-loop-"))
    filePath = join(tmpDir, "perm-test.txt")
    writeFileSync(filePath, "hello")
    config = {
      ...DEFAULT_PERMISSIONS,
      defaults: { bash: "ask", write: "ask", edit: "ask", read: "ask", glob: "ask", grep: "ask" },
      patterns: {},
    }
  })
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it("parks on PermissionRequestError, resumes on resolvePermission('allow')", async () => {
    // Build a real registry with the read tool, then wrap with
    // withPermission. The wrapper's settle is what we call from the TEP.
    const registry = createToolRegistry()
    registry.register({ read: readTool })
    const inner = registry.materialize()
    const wrapped: Materialization = withPermission(inner, () => config)

    // A TEP whose executeTool rewrites the path to the tmp file, then
    // delegates to the wrapped materialization. This is the gate the loop
    // actually hits.
    const gated: ToolEnabledProvider = new (class extends ToolEnabledProvider {
      override async executeTool(
        call: { id: string; name: string; input: unknown },
        context: { sessionID: string; agent: string; assistantMessageID: string },
      ) {
        const input: ExecuteInput = {
          sessionID: context.sessionID,
          agent: context.agent,
          assistantMessageID: context.assistantMessageID,
          call: { id: call.id, name: call.name, input: { path: filePath } },
        }
        const settlement = await wrapped.settle(input)
        return {
          result: settlement.result,
          output: settlement.output
            ? {
                structured: settlement.output.structured,
                content: settlement.output.content.map((c) => ({
                  type: c.type,
                  text: "text" in c ? c.text : undefined,
                })),
              }
            : undefined,
        }
      }
    })(new ToolIssuingReadProvider(), createToolRegistry())

    const runtime = new AgentRuntime(
      () => new GatedAgent(gated),
      makeSink(),
      { enableToolLoop: true, maxConcurrency: 1 },
    )
    const events: RuntimeEvent[] = []
    runtime.on((e) => events.push(e))

    const exec = runtime.execute(makeWorkspace("ws-park"))

    await new Promise<void>((resolve) => {
      if (events.some((e) => e.type === "permission-request")) return resolve()
      const interval = setInterval(() => {
        if (events.some((e) => e.type === "permission-request")) {
          clearInterval(interval)
          resolve()
        }
      }, 2)
    })

    const reqEvent = events.find((e) => e.type === "permission-request")
    expect(reqEvent).toBeDefined()
    if (reqEvent?.type !== "permission-request") throw new Error("event missing")
    expect(runtime.pendingPermissionCount()).toBe(1)

    // Flip config to allow, then resolve.
    config = {
      ...DEFAULT_PERMISSIONS,
      defaults: { bash: "allow", write: "allow", edit: "allow", read: "allow", glob: "allow", grep: "allow" },
      patterns: {},
    }
    expect(runtime.resolvePermission(reqEvent.requestId, "allow")).toBe(true)

    const ws = await exec
    expect(ws.status).toBe("completed")
    expect(runtime.pendingPermissionCount()).toBe(0)
    expect(events.some((e) => e.type === "permission-resolved")).toBe(true)

    // Audit log: an `ask` row paired with a matching `allow` row sharing
    // the same requestId, workspaceId, taskId, tool, target.
    const audit = runtime.getPermissionAudit();
    expect(audit.length).toBe(2);
    const askRow = audit.find((e) => e.decision === "ask");
    const allowRow = audit.find((e) => e.decision === "allow");
    expect(askRow).toBeDefined();
    expect(allowRow).toBeDefined();
    expect(askRow!.requestId).toBe(allowRow!.requestId);
    expect(allowRow!.promptedAt).toBe(askRow!.at);
    expect(askRow!.workspaceId).toBe("ws-park");
    expect(askRow!.tool).toBe("read");
  })
})
