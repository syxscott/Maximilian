/**
 * Tests for ModelRouter — task-aware model selection.
 */
import { describe, it, expect } from "vitest";
import {
  ModelRouter,
  createDefaultModelRouter,
  deriveTaskCharacteristics,
  type ModelProfile,
  type TaskCharacteristics,
} from "../src/model-router.js";
import { AgentRuntime } from "../src/runtime.js";
import { Agent, type AgentContext } from "../src/agent.js";
import type {
  AgentManifest,
  Plan,
  Result,
  Task,
  Workspace,
  RuntimeEvent,
} from "../src/types.js";
import type { Provider, ChatMessage, ChatResponse } from "@max/providers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STUB_MANIFEST: AgentManifest = {
  role: "general",
  displayName: "Stub",
  goal: "stub",
  systemPrompt: "stub",
};

class StubProvider implements Provider {
  id = "stub";
  name = "stub";
  defaultModel = "stub-1";
  isConfigured(): boolean {
    return true;
  }
  async chat(_messages: ChatMessage[]): Promise<ChatResponse> {
    return {
      content: "ok",
      model: "stub-1",
      usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
    };
  }
  async *stream() {
    /* noop */
    throw new Error("not used");
  }
}

class ModelTrackingAgent extends Agent {
  override readonly manifest = STUB_MANIFEST;
  /** Records the model override set by the runtime. */
  capturedOverride?: { provider: string; model: string };

  constructor() {
    super(new StubProvider());
  }

  override setModelOverride(provider: string, model: string): void {
    super.setModelOverride(provider, model);
    this.capturedOverride = { provider, model };
  }

  override async execute(_task: Task, _ctx: AgentContext): Promise<Result> {
    return {
      id: `r-${Math.random().toString(36).slice(2, 8)}`,
      taskId: _task.id,
      agentRole: _task.agentRole,
      output: "ok",
    };
  }
}

function makeWorkspace(
  id: string,
  tasks: Array<{ id: string; role: Task["agentRole"]; desc: string; dependsOn?: string[] }>,
): Workspace {
  const ts: Task[] = tasks.map((t) => ({
    id: t.id,
    description: t.desc,
    agentRole: t.role,
    dependsOn: t.dependsOn ?? [],
    status: "pending",
  }));
  const plan: Plan = { tasks: ts, edges: [] };
  return {
    id,
    userRequest: "test",
    plan,
    results: [],
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeSink() {
  return {
    workspaces: new Map<string, Workspace>(),
    async saveWorkspace(w: Workspace) {
      this.workspaces.set(w.id, w);
    },
    async loadWorkspace(id: string) {
      return this.workspaces.get(id);
    },
  };
}

// ---------------------------------------------------------------------------
// ModelRouter — unit tests
// ---------------------------------------------------------------------------

describe("ModelRouter", () => {
  describe("selectModel", () => {
    it("selects haiku for simple general tasks", () => {
      const router = createDefaultModelRouter();
      const sel = router.selectModel({
        complexity: "simple",
        type: "general",
        agentRole: "general",
      });
      expect(sel.provider).toBe("anthropic");
      expect(sel.model).toBe("claude-3-haiku-20240307");
    });

    it("selects claude-sonnet for medium code tasks", () => {
      const router = createDefaultModelRouter();
      const sel = router.selectModel({
        complexity: "medium",
        type: "code",
        agentRole: "backend",
      });
      expect(sel.provider).toBe("anthropic");
      expect(sel.model).toBe("claude-3-5-sonnet-20241022");
    });

    it("selects opus for complex code tasks", () => {
      const router = createDefaultModelRouter();
      const sel = router.selectModel({
        complexity: "complex",
        type: "code",
        agentRole: "backend",
      });
      // opus has code strength + high cost matches complex
      expect(sel.provider).toBe("anthropic");
      expect(sel.model).toBe("claude-3-opus-20240229");
    });

    it("selects o1 for complex reasoning tasks", () => {
      const router = createDefaultModelRouter();
      const sel = router.selectModel({
        complexity: "complex",
        type: "reasoning",
        agentRole: "review",
      });
      expect(sel.provider).toBe("openai");
      expect(sel.model).toBe("o1");
    });

    it("selects gemini for creative tasks", () => {
      const router = createDefaultModelRouter();
      const sel = router.selectModel({
        complexity: "medium",
        type: "creative",
        agentRole: "general",
      });
      expect(sel.provider).toBe("google");
      expect(sel.model).toBe("gemini-pro");
    });

    it("selects gpt-4o for data tasks", () => {
      const router = createDefaultModelRouter();
      const sel = router.selectModel({
        complexity: "medium",
        type: "data",
        agentRole: "general",
      });
      expect(sel.provider).toBe("openai");
      expect(sel.model).toBe("gpt-4o");
    });

    it("falls back to first registered profile when no strengths match", () => {
      const router = new ModelRouter([
        {
          provider: "custom",
          model: "only-model",
          strengths: [],
          costTier: "mid",
          speedTier: "medium",
        },
      ]);
      const sel = router.selectModel({
        complexity: "medium",
        type: "code",
        agentRole: "backend",
      });
      expect(sel.provider).toBe("custom");
      expect(sel.model).toBe("only-model");
    });

    it("returns hardcoded fallback when no profiles are registered", () => {
      const router = new ModelRouter();
      const sel = router.selectModel({
        complexity: "simple",
        type: "general",
        agentRole: "general",
      });
      expect(sel.provider).toBe("anthropic");
      expect(sel.model).toBe("claude-3-haiku-20240307");
    });
  });

  describe("registerProfile", () => {
    it("adds a new profile", () => {
      const router = new ModelRouter();
      router.registerProfile({
        provider: "custom",
        model: "m1",
        strengths: ["code"],
        costTier: "low",
        speedTier: "fast",
      });
      expect(router.getProfiles()).toHaveLength(1);
    });

    it("overwrites an existing profile with same provider+model", () => {
      const router = new ModelRouter();
      router.registerProfile({
        provider: "custom",
        model: "m1",
        strengths: ["code"],
        costTier: "low",
        speedTier: "fast",
      });
      router.registerProfile({
        provider: "custom",
        model: "m1",
        strengths: ["reasoning"],
        costTier: "high",
        speedTier: "slow",
      });
      expect(router.getProfiles()).toHaveLength(1);
      expect(router.getProfiles()[0].strengths).toEqual(["reasoning"]);
    });
  });
});

// ---------------------------------------------------------------------------
// deriveTaskCharacteristics
// ---------------------------------------------------------------------------

describe("deriveTaskCharacteristics", () => {
  it("maps frontend role to code type", () => {
    const chars = deriveTaskCharacteristics({
      agentRole: "frontend",
      description: "Build a button component",
    });
    expect(chars.type).toBe("code");
  });

  it("maps backend role to code type", () => {
    const chars = deriveTaskCharacteristics({
      agentRole: "backend",
      description: "Implement the API endpoint",
    });
    expect(chars.type).toBe("code");
  });

  it("maps review role to reasoning type", () => {
    const chars = deriveTaskCharacteristics({
      agentRole: "review",
      description: "Review the pull request",
    });
    expect(chars.type).toBe("reasoning");
  });

  it("detects complex complexity from keywords", () => {
    const chars = deriveTaskCharacteristics({
      agentRole: "backend",
      description: "Refactor the authentication system with security hardening",
    });
    expect(chars.complexity).toBe("complex");
  });

  it("detects simple complexity from keywords", () => {
    const chars = deriveTaskCharacteristics({
      agentRole: "frontend",
      description: "Fix typo in the header",
    });
    expect(chars.complexity).toBe("simple");
  });

  it("defaults to medium complexity for moderate descriptions", () => {
    const chars = deriveTaskCharacteristics({
      agentRole: "general",
      description:
        "Add a new tab to the settings page that displays user preferences and allows editing notification options",
    });
    expect(chars.complexity).toBe("medium");
  });
});

// ---------------------------------------------------------------------------
// Runtime integration
// ---------------------------------------------------------------------------

describe("Runtime ModelRouter integration", () => {
  it("sets model override on agent when modelRouter is configured", async () => {
    const agents: ModelTrackingAgent[] = [];
    const router = createDefaultModelRouter();

    const rt = new AgentRuntime(
      () => {
        const agent = new ModelTrackingAgent();
        agents.push(agent);
        return agent;
      },
      makeSink(),
      { modelRouter: router, maxConcurrency: 1 },
    );

    await rt.execute(
      makeWorkspace("ws-mr-1", [
        { id: "t1", role: "backend", desc: "Refactor the authentication module for security" },
      ]),
    );

    expect(agents).toHaveLength(1);
    expect(agents[0].capturedOverride).toBeDefined();
    // Complex code task should route to opus
    expect(agents[0].capturedOverride!.provider).toBe("anthropic");
    expect(agents[0].capturedOverride!.model).toBe("claude-3-opus-20240229");
  });

  it("selects cheap model for simple tasks", async () => {
    const agents: ModelTrackingAgent[] = [];
    const router = createDefaultModelRouter();

    const rt = new AgentRuntime(
      () => {
        const agent = new ModelTrackingAgent();
        agents.push(agent);
        return agent;
      },
      makeSink(),
      { modelRouter: router, maxConcurrency: 1 },
    );

    await rt.execute(
      makeWorkspace("ws-mr-2", [
        { id: "t1", role: "general", desc: "Fix typo in readme" },
      ]),
    );

    expect(agents).toHaveLength(1);
    expect(agents[0].capturedOverride).toBeDefined();
    // Simple general task should route to haiku
    expect(agents[0].capturedOverride!.provider).toBe("anthropic");
    expect(agents[0].capturedOverride!.model).toBe("claude-3-haiku-20240307");
  });

  it("does not set model override when modelRouter is absent", async () => {
    const agents: ModelTrackingAgent[] = [];

    const rt = new AgentRuntime(
      () => {
        const agent = new ModelTrackingAgent();
        agents.push(agent);
        return agent;
      },
      makeSink(),
      { maxConcurrency: 1 },
    );

    await rt.execute(
      makeWorkspace("ws-mr-3", [
        { id: "t1", role: "general", desc: "Fix typo in readme" },
      ]),
    );

    expect(agents).toHaveLength(1);
    expect(agents[0].capturedOverride).toBeUndefined();
  });

  it("routes different tasks to different models within the same workspace", async () => {
    const agents: ModelTrackingAgent[] = [];
    const router = createDefaultModelRouter();

    const rt = new AgentRuntime(
      () => {
        const agent = new ModelTrackingAgent();
        agents.push(agent);
        return agent;
      },
      makeSink(),
      { modelRouter: router, maxConcurrency: 2 },
    );

    await rt.execute(
      makeWorkspace("ws-mr-4", [
        { id: "t1", role: "general", desc: "Fix typo" },
        { id: "t2", role: "backend", desc: "Refactor the distributed system architecture" },
      ]),
    );

    expect(agents).toHaveLength(2);
    // t1 (simple general) -> haiku
    expect(agents[0].capturedOverride!.model).toBe("claude-3-haiku-20240307");
    // t2 (complex code) -> opus
    expect(agents[1].capturedOverride!.model).toBe("claude-3-opus-20240229");
  });
});
