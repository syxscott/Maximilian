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
    const outcome = runtime.resolveApproval(request.requestId, { decision: "approve" });
    expect(outcome.ok).toBe(true);

    const final = await executing;
    expect(final.status).toBe("completed");
    expect(final.results[0]?.agentId).toBe("human-approval");
    expect(runtime.pendingApprovalCount()).toBe(0);
    expect(events.some((event) => event.type === "approval-resolved")).toBe(true);
  });

  function makeRequireCommentWorkspace(): Workspace {
    return makeApprovalWorkspace(); // uses default metadata with requireComment=false
  }

  it("rejects an empty comment when requireComment is true", async () => {
    const runtime = new AgentRuntime(() => undefined, makeSink());
    const events: RuntimeEvent[] = [];
    runtime.on((event) => events.push(event));

    const ws = makeApprovalWorkspace();
    const task = ws.plan!.tasks[0]!;
    task.metadata = {
      kind: "approval",
      approval: { prompt: "Sign off", requireComment: true },
    };
    const executing = runtime.execute(ws);
    await new Promise((r) => setTimeout(r, 5));
    const request = events.find((event) => event.type === "approval-request")!;
    if (!request || request.type !== "approval-request") throw new Error("missing approval request");

    const outcome = runtime.resolveApproval(request.requestId, {
      decision: "approve",
      comment: "   ",
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("comment_required");
    expect(runtime.pendingApprovalCount()).toBe(1);

    const ok = runtime.resolveApproval(request.requestId, { decision: "approve", comment: "go" });
    expect(ok.ok).toBe(true);
    await executing;
  });

  it("returns unknown for a stale requestId", () => {
    const runtime = new AgentRuntime(() => undefined, makeSink());
    const outcome = runtime.resolveApproval("approval-missing", { decision: "approve" });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("unknown");
  });

  // ── M10: timeout emits approval-resolved so dashboard unparks ─────

  it("M10 regression: approval timeout emits an `approval-resolved` event with decision: reject", async () => {
    const events: RuntimeEvent[] = [];
    const runtime = new AgentRuntime(() => undefined, makeSink());
    runtime.on((e) => events.push(e));
    const ws = makeApprovalWorkspace();
    const task = ws.plan!.tasks[0]!;
    task.metadata = {
      kind: "approval",
      approval: {
        prompt: "Sign off",
        requireComment: false,
        timeoutMs: 50, // tiny timeout — should fire almost immediately
      },
    };
    await runtime.execute(ws);
    // After the timeout, we expect exactly one approval-resolved event
    // with decision: "reject" and a comment that mentions the timeout.
    const resolved = events.filter((e) => e.type === "approval-resolved");
    expect(resolved).toHaveLength(1);
    const r = resolved[0]!;
    if (r.type !== "approval-resolved") throw new Error("not resolved");
    expect(r.decision).toBe("reject");
    expect(r.comment).toMatch(/timed out/i);
  });
});
