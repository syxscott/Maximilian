/**
 * Tests for BullMQ queue integration in the chat route.
 *
 * Verifies that POST /api/chat enqueues a job when a queue is provided,
 * and falls back to in-process execution when no queue is set.
 */

import { describe, it, expect, vi } from "vitest";
import type { Context } from "hono";

// Mock BullMQ Queue
function createMockQueue() {
  const jobs: Array<{ name: string; data: unknown }> = [];
  return {
    add: vi.fn(async (name: string, data: unknown) => {
      jobs.push({ name, data });
      return { id: `job-${jobs.length}` };
    }),
    close: vi.fn(async () => {}),
    jobs,
  };
}

describe("Chat route queue integration", () => {
  it("enqueues a job when queue is provided", async () => {
    const mockQueue = createMockQueue();

    // Dynamically import to avoid side effects
    const { postChat } = await import("../src/routes/chat.js");

    const mockCommander = {
      plan: vi.fn(async (msg: string) => ({
        workspace: {
          id: "ws-1",
          userRequest: msg,
          status: "planning",
          results: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        plan: {
          id: "plan-1",
          workspaceId: "ws-1",
          userRequest: msg,
          rationale: "",
          tasks: [],
          createdAt: new Date().toISOString(),
        },
      })),
    };

    const mockStore = {
      saveWorkspace: vi.fn(async () => {}),
      loadWorkspace: vi.fn(async () => undefined),
    };

    const handler = postChat({
      commander: mockCommander as never,
      runtime: {} as never,
      store: mockStore as never,
      eventLog: new Map(),
      queue: mockQueue as never,
    });

    const fakeCtx = {
      req: {
        json: async () => ({ message: "hello" }),
      },
      json: (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status }),
      get: () => undefined,
    } as unknown as Context;

    const res = await handler(fakeCtx);
    const body = await (res as Response).json();

    expect(body.status).toBe("planning");
    expect(body.workspaceId).toBe("ws-1");
    expect(mockQueue.add).toHaveBeenCalledWith("execute", {
      workspaceId: "ws-1",
      mode: "commander",
    });
    // Should NOT have called runtime.execute (in-process)
    expect(mockStore.saveWorkspace).toHaveBeenCalledTimes(1); // only the initial save
  });

  it("runs in-process when no queue is provided", async () => {
    const { postChat } = await import("../src/routes/chat.js");

    let executeCalled = false;
    const mockRuntime = {
      execute: vi.fn(async (ws: { id: string }) => {
        executeCalled = true;
        return { ...ws, status: "completed", results: [] };
      }),
      on: vi.fn(),
    };

    const mockCommander = {
      plan: vi.fn(async (msg: string) => ({
        workspace: {
          id: "ws-2",
          userRequest: msg,
          status: "planning",
          results: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        plan: {
          id: "plan-2",
          workspaceId: "ws-2",
          userRequest: msg,
          rationale: "",
          tasks: [],
          createdAt: new Date().toISOString(),
        },
      })),
    };

    const mockStore = {
      saveWorkspace: vi.fn(async () => {}),
      loadWorkspace: vi.fn(async () => undefined),
    };

    const handler = postChat({
      commander: mockCommander as never,
      runtime: mockRuntime as never,
      store: mockStore as never,
      eventLog: new Map(),
      // no queue
    });

    const fakeCtx = {
      req: {
        json: async () => ({ message: "hello" }),
      },
      json: (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status }),
      get: () => undefined,
    } as unknown as Context;

    const res = await handler(fakeCtx);
    const body = await (res as Response).json();

    expect(body.status).toBe("planning");
    expect(body.workspaceId).toBe("ws-2");
    // runtime.execute should have been called (fire-and-forget)
    // Give the microtask queue a tick to run
    await new Promise((r) => setTimeout(r, 10));
    expect(executeCalled).toBe(true);
  });
});
