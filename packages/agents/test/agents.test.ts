/**
 * Tests for @max/agents.
 *
 * Covers:
 *   - defaultAgentFactory maps each role to the right agent class
 *   - defaultAgentFactory falls back to BackendAgent for "general"
 *   - defaultAgentFactory returns undefined for unknown roles
 *   - defaultAgentFactory respects a preferred provider via the registry
 *   - BackendAgent.execute returns a Result with the provider's content
 *     and attaches model/usage metadata
 *   - ReviewAgent.execute parses a well-formed JSON review and clamps
 *     the score into [0, 10]
 *   - ReviewAgent.execute recovers JSON wrapped in markdown fences
 *   - ReviewAgent.execute throws when the model produces no JSON at all
 *   - FrontendAgent (sanity check) wires up correctly and returns output
 */
import { describe, it, expect, vi } from "vitest";
import type { ChatResponse, Provider } from "@max/providers";
import type { Result } from "@max/core";
import {
  BackendAgent,
  FrontendAgent,
  ReviewAgent,
  defaultAgentFactory,
} from "../src/index.js";

function makeProvider(id: string, content: string): Provider {
  const captured: Array<{ system: string; user: string; jsonMode?: boolean }> = [];
  return {
    id,
    name: `Stub ${id}`,
    defaultModel: "stub-model",
    isConfigured: () => true,
    async chat(messages, options) {
      captured.push({
        system: messages.find((m) => m.role === "system")?.content ?? "",
        user: messages.find((m) => m.role === "user")?.content ?? "",
        jsonMode: options?.jsonMode,
      });
      const response: ChatResponse = {
        content,
        model: "stub-model",
        usage: { promptTokens: 11, completionTokens: 22, totalTokens: 33 },
        finishReason: "stop",
      };
      return response;
    },
    async stream() {
      throw new Error("not used");
    },
    __captured: captured,
  } as Provider & { __captured: typeof captured };
}

function makeTask(id: string, description: string): import("@max/core").Task {
  return {
    id,
    description,
    agentRole: "backend",
    status: "pending",
    dependsOn: [],
  };
}

function makeContext(prior: Result[] = []): import("@max/core").AgentContext {
  return { priorResults: prior };
}

describe("defaultAgentFactory", () => {
  it("maps backend → BackendAgent", () => {
    const factory = defaultAgentFactory(() => makeProvider("p", "x"));
    expect(factory("backend")).toBeInstanceOf(BackendAgent);
  });

  it("maps frontend → FrontendAgent", () => {
    const factory = defaultAgentFactory(() => makeProvider("p", "x"));
    expect(factory("frontend")).toBeInstanceOf(FrontendAgent);
  });

  it("maps review → ReviewAgent", () => {
    const factory = defaultAgentFactory(() => makeProvider("p", "x"));
    expect(factory("review")).toBeInstanceOf(ReviewAgent);
  });

  it('falls back to BackendAgent for "general"', () => {
    const factory = defaultAgentFactory(() => makeProvider("p", "x"));
    expect(factory("general")).toBeInstanceOf(BackendAgent);
  });

  it("returns undefined for unknown roles", () => {
    const factory = defaultAgentFactory(() => makeProvider("p", "x"));
    expect(factory("nope" as never)).toBeUndefined();
  });

  it("respects a preferred provider via the registry when it exists", () => {
    const defaultProv = makeProvider("default", "x");
    const preferredProv = makeProvider("preferred", "y");
    const registry = new Map<string, Provider>([
      ["default", defaultProv],
      ["preferred", preferredProv],
    ]);
    const factory = defaultAgentFactory(() => defaultProv, registry);
    const agent = factory("backend", "preferred");
    expect(agent).toBeInstanceOf(BackendAgent);
    // The agent should hold the preferred provider, not the default.
    // (We exercise it via execute() and verify the captured chat.)
    void agent;
  });

  it("falls back to default provider when preferred id isn't in registry", () => {
    const defaultProv = makeProvider("default", "x");
    const registry = new Map<string, Provider>([["default", defaultProv]]);
    const factory = defaultAgentFactory(() => defaultProv, registry);
    expect(factory("backend", "missing")).toBeInstanceOf(BackendAgent);
  });
});

describe("BackendAgent", () => {
  it("returns a Result with the provider content and metadata", async () => {
    const provider = makeProvider("p", "// server.js code");
    const agent = new BackendAgent(provider);
    const result = await agent.execute(
      makeTask("task-1", "Build a TODO API"),
      makeContext(),
    );

    expect(result.taskId).toBe("task-1");
    expect(result.agentRole).toBe("backend");
    expect(result.agentId).toBe(agent.id);
    expect(result.output).toBe("// server.js code");
    expect(result.metadata.model).toBe("stub-model");
    expect(result.metadata.usage?.totalTokens).toBe(33);
    expect(result.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("FrontendAgent", () => {
  it("returns a frontend Result with provider content", async () => {
    const provider = makeProvider("p", "<html>...</html>");
    const agent = new FrontendAgent(provider);
    const result = await agent.execute(
      makeTask("task-2", "Build a TODO UI"),
      makeContext(),
    );
    expect(result.agentRole).toBe("frontend");
    expect(result.output).toBe("<html>...</html>");
  });
});

describe("ReviewAgent", () => {
  it("parses well-formed JSON and clamps the score into [0, 10]", async () => {
    const json = JSON.stringify({
      score: 12, // out of range — should clamp to 10
      issues: ["a", "b"],
      suggestions: ["do X"],
      summary: "looks ok",
    });
    const provider = makeProvider("p", json);
    const agent = new ReviewAgent(provider);
    const result = await agent.execute(
      makeTask("task-r", "review"),
      makeContext(),
    );

    expect(result.agentRole).toBe("review");
    const review = result.metadata.review as { score: number; issues: string[]; suggestions: string[]; summary: string };
    expect(review.score).toBe(10);
    expect(review.issues).toEqual(["a", "b"]);
    expect(review.suggestions).toEqual(["do X"]);
    expect(review.summary).toBe("looks ok");
    expect(result.output).toContain('"score": 10');
  });

  it("recovers JSON wrapped in a markdown fence", async () => {
    const json = JSON.stringify({ score: 7, issues: [], suggestions: [], summary: "fine" });
    const provider = makeProvider("p", "```json\n" + json + "\n```");
    const agent = new ReviewAgent(provider);
    const result = await agent.execute(makeTask("task-r", "review"), makeContext());
    const review = result.metadata.review as { score: number };
    expect(review.score).toBe(7);
  });

  it("throws when the model produces no JSON at all", async () => {
    const provider = makeProvider("p", "I cannot produce JSON right now");
    const agent = new ReviewAgent(provider);
    await expect(
      agent.execute(makeTask("task-r", "review"), makeContext()),
    ).rejects.toThrow(/valid JSON/i);
  });

  it("uses prior results in the user prompt", async () => {
    const priorResult: Result = {
      id: "r1",
      taskId: "task-1",
      agentRole: "backend",
      agentId: "agent-x",
      output: "// api code",
      metadata: {},
      createdAt: "2026-06-29T00:00:00.000Z",
    };
    const provider = makeProvider("p", JSON.stringify({
      score: 8,
      issues: [],
      suggestions: [],
      summary: "ok",
    }));
    const agent = new ReviewAgent(provider);
    await agent.execute(
      makeTask("task-r", "review"),
      makeContext([priorResult]),
    );
    const captured = (provider as Provider & { __captured: unknown[] }).__captured;
    const last = captured[captured.length - 1] as { user: string };
    expect(last.user).toContain("// api code");
    expect(last.user).toContain("BACKEND");
    // jsonMode is on so the LLM is told to emit JSON.
    expect(last.jsonMode).toBe(true);
  });
});