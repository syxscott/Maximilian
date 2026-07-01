import { describe, it, expect } from "vitest";
import { AgentRuntime, type RuntimeEvent } from "../src/runtime.js";
import type { Plan, Task, Workspace } from "../src/types.js";

function makeSink() {
  return {
    workspaces: new Map<string, Workspace>(),
    async saveWorkspace(w: Workspace) { this.workspaces.set(w.id, w); },
    async loadWorkspace(id: string) { return this.workspaces.get(id); },
  };
}

function makeApprovalWorkspace(): Workspace {
  const task: Task = {
    id: "approval-1",
    agentRole: "general",
    description: "Approve generated feature outputs",
    status: "pending",
    dependsOn: [],
    metadata: {
      kind: "approval",
      approval: {
        prompt: "Review before final handoff",
        requireComment: false,
        reason: "Key feature annotation completed",
      },
    },
  };
  const plan: Plan = {
    id: "plan-approval",
    workspaceId: "ws-approval",
    userRequest: "build feature",
    rationale: "approval test",
    tasks: [task],
    createdAt: new Date().toISOString(),
  };
  return {
    id: "ws-approval",
    userRequest: "build feature",
    status: "planning",
    plan,
    results: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: {},
  };
}

describe("AgentRuntime approval pause/resume", () => {
  it("parks an approval task until resolveApproval approves it", async () => {
    const runtime = new AgentRuntime(() => undefined, makeSink());
    const events: RuntimeEvent[] = [];
    runtime.on((event) => events.push(event));

    const executing = runtime.execute(makeApprovalWorkspace());
    await new Promise((resolve) => setTimeout(resolve, 5));

    const request = events.find((event) => event.type === "approval-request");
    expect(request).toBeDefined();
    expect(runtime.pendingApprovalCount()).toBe(1);

    if (!request || request.type !== "approval-request") {
      throw new Error("approval request was not emitted");
    }

    expect(request.prompt).toBe("Review before final handoff");
    expect(runtime.resolveApproval(request.requestId, { decision: "approve" })).toBe(true);

    const final = await executing;
    expect(final.status).toBe("completed");
    expect(final.results[0]?.agentId).toBe("human-approval");
    expect(runtime.pendingApprovalCount()).toBe(0);
    expect(events.some((event) => event.type === "approval-resolved")).toBe(true);
  });
});
