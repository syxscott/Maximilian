/**
 * Smoke test: validates the core wiring without calling a real LLM.
 *
 * What it verifies:
 *   - WorkspaceStore round-trips a workspace to disk and back.
 *   - AgentRuntime executes tasks in dependency order.
 *   - Review Agent schema can be parsed.
 *
 * Run with: pnpm --filter @max/api test
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

import { AgentRuntime, Agent, type AgentContext, type AgentManifest, type Result, type Task, type Workspace } from "@max/core";
import { FileWorkspaceStore } from "@max/workspace";
import type { Provider } from "@max/providers";

const fakeProvider: Provider = {
  id: "fake",
  name: "Fake",
  defaultModel: "fake-model",
  isConfigured: () => true,
  chat: async (messages) => ({
    content: `echo: ${messages[messages.length - 1]?.content ?? ""}`,
    model: "fake-model",
  }),
  stream: async function* () {
    yield { delta: "fake", done: true };
  },
};

class StubAgent extends Agent {
  override readonly manifest: AgentManifest = {
    role: "general",
    displayName: "Stub",
    goal: "Echo back",
    systemPrompt: "Echo user message verbatim.",
  };

  override async execute(task: Task): Promise<Result> {
    const res = await this.provider.chat([
      { role: "user", content: task.description },
    ]);
    return {
      id: `res-${task.id}`,
      taskId: task.id,
      agentRole: "general",
      agentId: this.id,
      output: res.content,
      metadata: {},
      createdAt: new Date().toISOString(),
    };
  }
}

describe("MVP smoke", () => {
  let tmpDir: string;
  let store: FileWorkspaceStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "max-"));
    store = new FileWorkspaceStore(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("persists a workspace to disk", async () => {
    const ws: Workspace = {
      id: "ws-test",
      userRequest: "hello",
      status: "planning",
      results: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {},
    };
    await store.saveWorkspace(ws);
    const loaded = await store.loadWorkspace("ws-test");
    expect(loaded?.id).toBe("ws-test");
    expect(loaded?.userRequest).toBe("hello");
  });

  it("runtime executes tasks in dependency order", async () => {
    const factory = (role: string): Agent | undefined => {
      if (role === "general" || role === "frontend" || role === "backend" || role === "review") {
        return new StubAgent(fakeProvider);
      }
      return undefined;
    };
    const runtime = new AgentRuntime(factory, store);

    const workspace: Workspace = {
      id: "ws-rt",
      userRequest: "test",
      status: "planning",
      plan: {
        id: "plan-rt",
        workspaceId: "ws-rt",
        userRequest: "test",
        rationale: "test",
        tasks: [
          { id: "task-1", agentRole: "general", description: "first", status: "pending", dependsOn: [] },
          { id: "task-2", agentRole: "general", description: "second", status: "pending", dependsOn: ["task-1"] },
          { id: "task-3", agentRole: "general", description: "third", status: "pending", dependsOn: ["task-2"] },
        ],
        createdAt: new Date().toISOString(),
      },
      results: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {},
    };

    const order: string[] = [];
    runtime.on((event) => {
      if (event.type === "task-complete") {
        order.push(event.taskId);
      }
    });

    const final = await runtime.execute(workspace);
    expect(order).toEqual(["task-1", "task-2", "task-3"]);
    expect(final.status).toBe("completed");
    expect(final.results).toHaveLength(3);
    expect(final.results[0].output).toBe("echo: first");
    expect(final.results[1].output).toBe("echo: second");
    expect(final.results[2].output).toBe("echo: third");
  });

  it("fails fast when a task errors", async () => {
    const factory = (role: string): Agent | undefined => {
      return new (class extends Agent {
        override readonly manifest: AgentManifest = {
          role: "general",
          displayName: "Fail",
          goal: "fail",
          systemPrompt: "",
        };
        override async execute(): Promise<Result> {
          throw new Error("boom");
        }
      })(fakeProvider);
    };
    const runtime = new AgentRuntime(factory, store);

    const workspace: Workspace = {
      id: "ws-fail",
      userRequest: "fail",
      status: "planning",
      plan: {
        id: "plan-fail",
        workspaceId: "ws-fail",
        userRequest: "fail",
        rationale: "",
        tasks: [
          { id: "task-1", agentRole: "general", description: "x", status: "pending", dependsOn: [] },
          { id: "task-2", agentRole: "general", description: "y", status: "pending", dependsOn: ["task-1"] },
        ],
        createdAt: new Date().toISOString(),
      },
      results: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {},
    };

    const final = await runtime.execute(workspace);
    expect(final.status).toBe("failed");
    expect(final.results).toHaveLength(0);
    expect(final.error).toContain("boom");
    const task1 = final.plan!.tasks.find((t) => t.id === "task-1")!;
    expect(task1.status).toBe("failed");
    expect(task1.error).toContain("boom");
  });

  it("saves artifacts to workspace files directory", async () => {
    const savedName = await store.saveArtifact("ws-art", "test.html", "<html/>");
    const content = await store.readArtifact("ws-art", "test.html");
    expect(content).toBe("<html/>");
    expect(savedName).toBe("test.html");
    const list = await store.listArtifacts("ws-art");
    expect(list).toContain("test.html");
  });

  it("listWorkspaces pagination rejects invalid cursor with 400", async () => {
    const { listWorkspaces } = await import("../src/routes/workspace.js");
    const handler = listWorkspaces(store);
    const fakeCtx = {
      req: {
        query: (key: string) => (key === "cursor" ? "not-a-real-id" : undefined),
        valid: (type: string) => {
          if (type === "query") return { cursor: "not-a-real-id", limit: 20 };
          return {};
        },
      },
      json: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
      get: () => undefined,
    } as unknown as Parameters<typeof handler>[0];
    const res = await handler(fakeCtx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_cursor");
  });

  it("runtime never exceeds maxConcurrency under contention", { timeout: 15_000 }, async () => {
    // Regression test for C4: Semaphore had a non-atomic R-M-W that
    // could admit more than `max` concurrent tasks under load.
    const { AgentRuntime, Agent } = await import("@max/core");
    let inFlight = 0;
    let maxObserved = 0;
    const factory = (): Agent => new (class extends Agent {
      override readonly manifest: AgentManifest = {
        role: "general", displayName: "Counter", goal: "count", systemPrompt: "",
      };
      override async execute(_t: Task, _c: AgentContext): Promise<Result> {
        inFlight++;
        maxObserved = Math.max(maxObserved, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return {
          id: `r-${Math.random()}`, taskId: _t.id, agentRole: "general",
          agentId: this.id, output: "ok", metadata: {},
          createdAt: new Date().toISOString(),
        };
      }
    })(fakeProvider);

    const runtime = new AgentRuntime(factory, store, { maxConcurrency: 3 });
    const tasks = Array.from({ length: 30 }, (_, i) => ({
      id: `t-${i}`, agentRole: "general", description: `task ${i}`,
      status: "pending" as const, dependsOn: [],
    }));
    const workspace: Workspace = {
      id: "ws-sem", userRequest: "concurrent", status: "planning", plan: {
        id: "p-sem", workspaceId: "ws-sem", userRequest: "concurrent",
        rationale: "", tasks, createdAt: new Date().toISOString(),
      },
      results: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      metadata: {},
    };
    await runtime.execute(workspace);
    expect(maxObserved).toBeLessThanOrEqual(3);
  });
});