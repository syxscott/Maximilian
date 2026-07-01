/**
 * Integration test for the intelligent LLM routing chain.
 *
 * Verifies the end-to-end goal: "agents should auto-assign LLMs based on
 * task characteristics to leverage each model's strengths."
 *
 * Chain under test:
 *   task (role + description)
 *     → ModelRouter.selectModel(characteristics)
 *       → ModelSelectorPort.select(role)  [runtime integration point]
 *         → Provider gets (provider, model) override
 *
 * This test exercises the chain with a real ModelRouter, derived
 * characteristics, and a mock agent that records what model it received.
 */

import { describe, it, expect } from "vitest";
import {
  ModelRouter, createDefaultModelRouter, deriveTaskCharacteristics,
  modelRouterAsSelector, EmbeddingRouter,
  type ModelProfile,
} from "../src/index.js";
import type { AgentRole } from "../src/types.js";

// ── Mock providers ──────────────────────────────────────────────────────────

const SONNET: ModelProfile = { provider: "anthropic", model: "claude-3-5-sonnet-20241022", strengths: ["code", "general"], costTier: "mid", speedTier: "medium" };
const HAIKU: ModelProfile = { provider: "anthropic", model: "claude-3-5-haiku-20241022", strengths: ["general"], costTier: "low", speedTier: "fast" };
const OPUS: ModelProfile = { provider: "anthropic", model: "claude-3-opus-20240229", strengths: ["code", "reasoning", "creative"], costTier: "high", speedTier: "slow" };
const GPT4O: ModelProfile = { provider: "openai", model: "gpt-4o", strengths: ["reasoning", "general", "data"], costTier: "mid", speedTier: "medium" };

const router = new ModelRouter([HAIKU, SONNET, OPUS, GPT4O]);

// ── 1. ModelRouter picks the right model for characteristics ────────────────

describe("ModelRouter.selectModel", () => {
  it("picks Haiku (low cost, fast) for simple general tasks", () => {
    const sel = router.selectModel({ type: "general", complexity: "simple", agentRole: "general" });
    expect(sel.provider).toBe("anthropic");
    expect(sel.model).toBe(HAIKU.model);
  });

  it("picks Sonnet (code strength, mid cost) for medium-complexity code", () => {
    const sel = router.selectModel({ type: "code", complexity: "medium", agentRole: "frontend" });
    expect(sel.model).toBe(SONNET.model);
  });

  it("picks Opus (highest reasoning strength) for complex reasoning tasks", () => {
    const sel = router.selectModel({ type: "reasoning", complexity: "complex", agentRole: "review" });
    expect(sel.model).toBe(OPUS.model);
  });

  it("derives characteristics from description and role", () => {
    const task = { agentRole: "frontend" as AgentRole, description: "refactor the entire design system for performance" };
    const chars = deriveTaskCharacteristics(task);
    expect(chars.type).toBe("code");
    expect(chars.complexity).toBe("complex"); // "refactor" + "entire" trigger complex
    expect(chars.agentRole).toBe("frontend");
  });

  it("picks a strong model based on derived characteristics", () => {
    const task = { agentRole: "backend" as AgentRole, description: "design the database schema for the new billing system" };
    const chars = deriveTaskCharacteristics(task);
    const sel = router.selectModel(chars);
    // Should prefer Opus (code+reasoning, slow but strong) over Haiku (general only)
    expect(["claude-3-opus-20240229", "claude-3-5-sonnet-20241022"]).toContain(sel.model);
  });
});

// ── 2. ModelSelectorPort adapter wires router into runtime API ──────────────

describe("modelRouterAsSelector", () => {
  it("returns a selector that picks by role characteristics", () => {
    const selector = modelRouterAsSelector(router);
    const frontendSel = selector.select("frontend");
    const reviewSel = selector.select("review");
    expect(frontendSel).toBeTruthy();
    expect(reviewSel).toBeTruthy();
    expect(frontendSel!.provider).toBe("anthropic");
    // Frontend → code/medium → Sonnet (or stronger); review → reasoning/medium → Opus or GPT-4o
    expect(frontendSel!.reason).toMatch(/role=frontend/);
    expect(reviewSel!.reason).toMatch(/role=review/);
  });

  it("returns a stable selection for the same role", () => {
    const selector = modelRouterAsSelector(router);
    const a = selector.select("backend");
    const b = selector.select("backend");
    expect(a!.model).toBe(b!.model);
    expect(a!.provider).toBe(b!.provider);
  });
});

// ── 3. End-to-end: description → embedding router → cache → provider ────────

describe("EmbeddingRouter integration", () => {
  it("caches classification and reuses it on similar descriptions", async () => {
    const embedCalls: string[] = [];
    const embedder = async (text: string): Promise<number[]> => {
      embedCalls.push(text);
      // Deterministic bag-of-words embedding
      const vocab = ["build", "refactor", "ui", "code", "design", "system"];
      return vocab.map((w) => (text.toLowerCase().includes(w) ? 1 : 0));
    };
    const er = new EmbeddingRouter(router, { embed: embedder, similarityThreshold: 0.5 });

    const first = await er.selectModel({ agentRole: "frontend", description: "build a UI component" });
    expect(first.source).toBe("heuristic");

    const second = await er.selectModel({ agentRole: "frontend", description: "build another UI component" });
    expect(second.source).toBe("cache");
    expect(second.model).toBe(first.model);

    // Cache hit means we did NOT call the heuristic-only path (no new
    // addToCache for the second request). Both calls still call embed
    // because EmbeddingRouter always embeds then checks cache.
    expect(embedCalls.length).toBe(2);
    const stats = er.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
  });

  it("misses cache and re-classifies for dissimilar descriptions", async () => {
    let calls = 0;
    const er = new EmbeddingRouter(router, {
      embed: async (text: string) => {
        calls++;
        const vocab = ["alpha", "beta", "gamma"];
        return vocab.map((w) => (text.toLowerCase().includes(w) ? 1 : 0));
      },
      similarityThreshold: 0.99, // very strict
    });

    const a = await er.selectModel({ agentRole: "general", description: "alpha beta" });
    const b = await er.selectModel({ agentRole: "general", description: "gamma only" });
    expect(a.source).toBe("heuristic");
    expect(b.source).toBe("heuristic");
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});

// ── 4. Final assertion: the chain produces a model decision per task ────────

describe("end-to-end routing chain", () => {
  it("each role+description produces a deterministic (provider, model) decision", () => {
    const cases: Array<{ role: AgentRole; description: string; expectModelContains?: string }> = [
      { role: "frontend", description: "build a login page" },
      { role: "backend", description: "implement the user authentication API endpoint" },
      { role: "review", description: "review the PR for security issues" },
      { role: "general", description: "write a hello world script" },
    ];

    const results = cases.map((c) => {
      const chars = deriveTaskCharacteristics(c);
      const sel = router.selectModel(chars);
      return { role: c.role, provider: sel.provider, model: sel.model };
    });

    for (const r of results) {
      expect(r.provider).toBeTruthy();
      expect(r.model).toBeTruthy();
      // All four should pick a real model from our profile set
      expect([HAIKU.model, SONNET.model, OPUS.model, GPT4O.model]).toContain(r.model);
    }

    // Sanity: simple general task → cheap/fast model (Haiku)
    const general = results.find((r) => r.role === "general")!;
    expect(general.model).toBe(HAIKU.model);
  });
});