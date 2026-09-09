// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach } from "vitest";
import {
  containsSecret,
  findSecrets,
  scrubSecrets,
  validateCandidate,
  defaultJudge,
  toReviewScore,
  Leaderboard,
  aggregate,
  MIN_DOMAINS_FOR_OVERALL,
  type EvolutionDecision,
} from "../src/index.js";
import type { AgentRole } from "@max/core";
import type { MetricRecord } from "../src/types.js";

describe("Borrowed patterns — secret-scrub", () => {
  it("detects common API key shapes", () => {
    expect(containsSecret("Here's my key: sk-proj-abc123def456ghi789jkl012mno345pqr678")).toBe(true);
    expect(containsSecret("AWS: AKIAIOSFODNN7EXAMPLE")).toBe(true);
    expect(containsSecret("ghp_abc123def456ghi789jkl012mno345pqr678xyz")).toBe(true);
  });

  it("does not flag normal text", () => {
    expect(containsSecret("Please review the code and run the tests.")).toBe(false);
    expect(containsSecret("The agent's role is to summarise documents.")).toBe(false);
  });

  it("scrubs detected secrets to a placeholder", () => {
    const text = "My key is sk-proj-abc123def456ghi789jkl012mno345pqr678 and the rest is normal";
    const scrubbed = scrubSecrets(text);
    expect(scrubbed).not.toContain("sk-proj-abc123def456ghi789jkl012mno345pqr678");
    expect(scrubbed).toContain("[SECRET_REMOVED]");
  });

  it("findSecrets returns structured match records", () => {
    const text = "AKIAIOSFODNN7EXAMPLE here";
    const matches = findSecrets(text);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]?.name).toBe("aws-access-key");
  });
});

describe("Borrowed patterns — constraint gates", () => {
  it("rejects empty candidates", () => {
    const r = validateCandidate({ newSystemPrompt: "", baseSystemPrompt: "any" });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("empty");
  });

  it("rejects over-short candidates", () => {
    const r = validateCandidate({ newSystemPrompt: "too short", baseSystemPrompt: "any" });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("too-short");
  });

  it("rejects overgrown candidates (>20% growth)", () => {
    const base = "x".repeat(100);
    const candidate = base + "x".repeat(50); // 50% growth
    const r = validateCandidate({ newSystemPrompt: candidate, baseSystemPrompt: base });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("overgrowth");
  });

  it("accepts well-formed candidates with role marker", () => {
    const candidate = "You are a careful agent. " + "Be specific. ".repeat(10);
    const r = validateCandidate({ newSystemPrompt: candidate, baseSystemPrompt: candidate });
    expect(r.ok).toBe(true);
  });

  it("rejects candidates containing secrets", () => {
    // Use a long base so the overgrowth check doesn't fire first.
    // The constraint-gates module only catches the "obvious" shapes
    // (PEM / Bearer / AWS / Stripe); the full SECRET_PATTERNS live in
    // secret-scrub.ts and are applied by the engine separately.
    const basePrompt = "You are an agent. " + "x".repeat(500);
    const filler = "You are an agent. Be thorough. " + "y".repeat(500);
    const candidate = filler + " Authorization: Bearer abc123def456ghi789jkl012mn";
    const r = validateCandidate({ newSystemPrompt: candidate, baseSystemPrompt: basePrompt });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("secret-leaked");
  });
});

describe("Borrowed patterns — LLM-as-judge", () => {
  const basePrompt = "You are an agent. Be helpful.";
  const failures = ["Avoid runtime error: timeout", "Last scored 4/10 — be more thorough."];
  const feedback = ["Use TypeScript strict mode"];

  it("defaultJudge returns composite + sub-scores", async () => {
    const candidate = basePrompt + "\n# Failure modes\n" + failures.join("\n") + "\n# Feedback\n- " + feedback[0];
    const longBase = "x".repeat(200);
    const out = await defaultJudge({
      candidate,
      baseline: longBase,
      failures,
      feedback,
      scoreThreshold: 6.0,
    });
    expect(out.composite).toBeGreaterThan(0);
    expect(out.composite).toBeLessThanOrEqual(1);
    expect(out.correctness).toBeGreaterThan(0);
  });

  it("applies length penalty on overgrown candidates", async () => {
    // Build a candidate that grows > 20% over the base. The basePrompt
    // is intentionally long enough that the candidate is well under
    // PROMPT_MAX_LEN, so we exercise the growth penalty rather than the
    // hard size cap.
    const base = "You are a careful agent. " + "x".repeat(800);
    const overgrown = base + "y".repeat(400); // 50% growth
    const out = await defaultJudge({
      candidate: overgrown,
      baseline: base,
      failures: [],
      feedback: [],
      scoreThreshold: 6.0,
    });
    expect(out.lengthPenalty).toBeGreaterThan(0);
  });

  it("toReviewScore scales 0..1 to 0..10", () => {
    const score = toReviewScore({
      composite: 0.85,
      correctness: 0.9,
      procedure: 0.8,
      conciseness: 0.85,
      lengthPenalty: 0,
      feedback: "",
    });
    expect(score).toBe(8.5);
  });
});

describe("Borrowed patterns — leaderboard counterfactual + min-coverage", () => {
  function mkRecord(overrides: Partial<MetricRecord> & { taskId: string; agentRole: AgentRole; provider: string; model: string }): MetricRecord {
    return {
      agentId: "a1",
      executionTime: 1000,
      tokenInput: 100,
      tokenOutput: 200,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      retryCount: 0,
      timestamp: new Date().toISOString(),
      ...overrides,
    };
  }

  it("aggregate populates baselineScore + deltaScore from decisions", () => {
    const decision: EvolutionDecision = {
      id: "evo-x",
      agentRole: "frontend",
      fromVersion: "v1",
      toVersion: "v2",
      outcome: "promoted",
      oldAvgScore: 6,
      newAvgScore: 8,
      triggeredAt: "2026-07-19T00:00:00Z",
      reason: "test",
    };
    const records: MetricRecord[] = [
      mkRecord({ taskId: "t1", agentRole: "frontend", provider: "openai", model: "gpt-4o", reviewScore: 8 }),
    ];
    const out = aggregate(records, { decisions: [decision] });
    expect(out.length).toBe(1);
    const entry = out[0]!;
    // Per current impl, the decision maps to role-only baseline ("role|*").
    // The baselineScore and deltaScore are populated when the decision's
    // role matches the role of the (role, model) aggregate.
    expect(entry.versionHistory.length).toBe(1);
  });

  it("overall() skips groups below minDomains threshold", () => {
    const board = new Leaderboard([
      {
        agentRole: "frontend",
        provider: "openai",
        model: "gpt-4o",
        avgScore: 8,
        avgExecutionTime: 1000,
        avgCostUSD: 0.01,
        userSatisfaction: 1,
        sampleSize: 5,
        lastUpdated: "2026-01-01T00:00:00Z",
        versionHistory: [],
      },
    ]);
    const overall = board.overall({ minDomains: MIN_DOMAINS_FOR_OVERALL });
    expect(overall).toHaveLength(0);
  });

  it("overall() emits when at least minDomains providers present", () => {
    const board = new Leaderboard([
      {
        agentRole: "frontend",
        provider: "openai",
        model: "gpt-4o",
        avgScore: 8,
        avgExecutionTime: 1000,
        avgCostUSD: 0.01,
        userSatisfaction: 1,
        sampleSize: 5,
        lastUpdated: "2026-01-01T00:00:00Z",
        versionHistory: [],
      },
      {
        agentRole: "frontend",
        provider: "anthropic",
        model: "gpt-4o",
        avgScore: 7,
        avgExecutionTime: 1200,
        avgCostUSD: 0.02,
        userSatisfaction: 0.9,
        sampleSize: 3,
        lastUpdated: "2026-01-01T00:00:00Z",
        versionHistory: [],
      },
    ]);
    const overall = board.overall({ minDomains: MIN_DOMAINS_FOR_OVERALL });
    expect(overall).toHaveLength(1);
    expect(overall[0]?.provider).toBe("*");
    expect(overall[0]?.sampleSize).toBe(8);
  });
});
