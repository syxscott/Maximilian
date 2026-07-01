/**
 * Phase 9 — CLI tests.
 *
 * Tests arg parsing, table rendering, and summary output.
 * Does not test actual benchmark execution (requires provider).
 */

import { describe, it, expect } from "vitest";
import { BenchmarkEvaluator } from "../src/evaluator.js";
import { CachingBenchmarkBridge } from "../src/bridge-impl.js";
import type { BenchmarkResult } from "../src/types.js";
import type { Provider, ChatResponse } from "@max/providers";

// ── CachingBenchmarkBridge ───────────────────────────────────────────────────

describe("CachingBenchmarkBridge", () => {
  it("records and retrieves quality profiles", async () => {
    const bridge = new CachingBenchmarkBridge();
    const result: BenchmarkResult = {
      taskId: "t1",
      passed: true,
      quality: 0.8,
      latencyMs: 500,
      tokenUsage: { prompt: 100, completion: 50, total: 150 },
      acceptanceScore: 0.8,
      output: "SELECT 1",
    };

    bridge.recordOne("engineer", result);
    const profile = await bridge.getQualityProfile("engineer");

    expect(profile).not.toBeNull();
    expect(profile!.qualityScore).toBe(8); // 0.8 * 10
    expect(profile!.latencyMs).toBe(500);
  });

  it("returns null for unknown role", async () => {
    const bridge = new CachingBenchmarkBridge();
    const profile = await bridge.getQualityProfile("unknown");
    expect(profile).toBeNull();
  });

  it("aggregates multiple results for same role", async () => {
    const bridge = new CachingBenchmarkBridge();
    bridge.record("engineer", [
      { taskId: "t1", passed: true, quality: 1, latencyMs: 200, tokenUsage: { prompt: 100, completion: 50, total: 150 }, acceptanceScore: 1, output: "" },
      { taskId: "t2", passed: false, quality: 0, latencyMs: 800, tokenUsage: { prompt: 200, completion: 100, total: 300 }, acceptanceScore: 0, output: "" },
    ]);

    const profile = await bridge.getQualityProfile("engineer");
    expect(profile!.qualityScore).toBe(5); // (10+0)/2
    expect(profile!.latencyMs).toBe(500); // (200+800)/2
  });

  it("hasRole returns correct state", () => {
    const bridge = new CachingBenchmarkBridge();
    expect(bridge.hasRole("engineer")).toBe(false);
    bridge.recordOne("engineer", {
      taskId: "t1", passed: true, quality: 1, latencyMs: 100,
      tokenUsage: { prompt: 10, completion: 5, total: 15 },
      acceptanceScore: 1, output: "",
    });
    expect(bridge.hasRole("engineer")).toBe(true);
  });

  it("getRoles returns all recorded roles", () => {
    const bridge = new CachingBenchmarkBridge();
    bridge.recordOne("a", { taskId: "t1", passed: true, quality: 1, latencyMs: 100, tokenUsage: { prompt: 10, completion: 5, total: 15 }, acceptanceScore: 1, output: "" });
    bridge.recordOne("b", { taskId: "t2", passed: true, quality: 1, latencyMs: 100, tokenUsage: { prompt: 10, completion: 5, total: 15 }, acceptanceScore: 1, output: "" });
    expect(bridge.getRoles()).toEqual(expect.arrayContaining(["a", "b"]));
  });

  it("clear removes all data", async () => {
    const bridge = new CachingBenchmarkBridge();
    bridge.recordOne("a", { taskId: "t1", passed: true, quality: 1, latencyMs: 100, tokenUsage: { prompt: 10, completion: 5, total: 15 }, acceptanceScore: 1, output: "" });
    bridge.clear();
    const profile = await bridge.getQualityProfile("a");
    expect(profile).toBeNull();
  });
});

// ── Evaluator with DevOps domain ─────────────────────────────────────────────

function makeMockProvider(response: string): Provider {
  return {
    id: "mock",
    name: "mock",
    defaultModel: "mock-1",
    isConfigured: () => true,
    chat: async (): Promise<ChatResponse> => ({
      content: response,
      model: "mock-1",
      usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
    }),
    stream: async function* () { yield { delta: "ok", done: true }; },
  };
}

describe("BenchmarkEvaluator (devops)", () => {
  it("evaluates a devops task through baseline", async () => {
    const { BenchmarkTask } = await import("../src/types.js");
    const task = {
      id: "test-devops",
      domain: "devops" as const,
      difficulty: "hard" as const,
      input: "Create a file called output.txt",
      context: {
        initialFiles: {},
        assertions: [{ path: "output.txt", check: "exists" as const }],
      },
      expectedOutputAssertion: async () => true,
    };

    const mockScript = "```bash\necho hello > output.txt\n```";
    const provider = makeMockProvider(mockScript);
    const mockDags = { compose: async () => ({}) } as never;

    const evaluator = new BenchmarkEvaluator({ provider, dags: mockDags });
    const result = await evaluator.evaluateBaseline(task);

    expect(result.taskId).toBe("test-devops");
    expect(result.quality).toBe(1);
    expect(result.passed).toBe(true);
  });
});

describe("BenchmarkEvaluator (frontend)", () => {
  it("evaluates a frontend task through baseline", async () => {
    const task = {
      id: "test-frontend",
      domain: "frontend" as const,
      difficulty: "hard" as const,
      input: "Create a counter component",
      context: {
        componentType: "react",
        requirements: ["Must use useState"],
        structuralQueries: [
          { pattern: "useState\\s*\\(", required: true, label: "Uses useState" },
        ],
      },
      expectedOutputAssertion: async () => true,
    };

    const mockCode = "```tsx\nexport default function Counter() {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;\n}\n```";
    const provider = makeMockProvider(mockCode);
    const mockDags = { compose: async () => ({}) } as never;

    const evaluator = new BenchmarkEvaluator({ provider, dags: mockDags });
    const result = await evaluator.evaluateBaseline(task);

    expect(result.taskId).toBe("test-frontend");
    // Quality > 0.5 because required patterns found + built-in checks partial match
    expect(result.quality).toBeGreaterThan(0.5);
    // passed requires quality >= 1.0 (all optional patterns too), so it's false here
    expect(result.passed).toBe(false);
  });
});
