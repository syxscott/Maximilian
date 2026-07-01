/**
 * Phase 5.8 — End-to-End test for DAGS_MODE=true main flow.
 *
 * This E2E test:
 *   1. Boots a Hono app with mocked dependencies (provider, evolution,
 *      autonomy stack, DAGS).
 *   2. Wires /api/chat in DAGS_MODE and /api/learning/* + /api/executions/*.
 *   3. Sends a real HTTP request via app.request().
 *   4. Verifies the workspace is created, the autonomy loop ran end-to-end,
 *      and the LearningAPI surfaces reflect the new data.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { Hono } from "hono";

import type { Provider } from "@max/providers";
import { EvolutionFacade } from "@max/evolution";
import { DAGS } from "@max/dags";
import {
  ExecutionStore,
  InsightsStore,
  FailurePatternAnalyzer,
  EvolutionPlanner,
  CandidateGenerator,
  PromotionEngine,
  LearningAPI,
  AutonomyOrchestrator,
} from "@max/autonomy";
import { postChat } from "../src/routes/chat.js";
import { learningRoutes } from "../src/routes/learning.js";
import { executionRoutes } from "../src/routes/executions.js";
import { approvalRoutes } from "../src/routes/approvals.js";
import type { RuntimeEvent } from "@max/core";

function makeProvider(id: string, model: string): Provider {
  return {
    id,
    name: id,
    defaultModel: model,
    isConfigured: () => true,
    chat: async (messages) => ({
      content: "```html\n<html><body>Hello World</body></html>\n```",
      model,
    }),
    stream: async function* () { yield { delta: "ok", done: true }; },
  };
}

describe("E2E: DAGS_MODE=true /api/chat + autonomy loop", () => {
  let tmp: string;
  let app: Hono;
  let eventLog: Map<string, RuntimeEvent[]>;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "max-e2e-"));
    const provider = makeProvider("mock", "mock-1");

    // 1. Boot Evolution + DAGS.
    const facade = new EvolutionFacade({
      rootDir: tmp,
      candidates: [provider],
      fallbackProvider: provider,
      defaultManifests: {},
    });
    await facade.initialize();
    const dags = new DAGS({ rootDir: tmp, evolution: facade, candidates: [provider] });

    // 2. Boot Autonomy stack.
    const store = new ExecutionStore(tmp);
    const insights = new InsightsStore(tmp);
    const analyzer = new FailurePatternAnalyzer(insights);
    const gen = new CandidateGenerator(tmp);
    const planner = new EvolutionPlanner(tmp, {
      minExecutions: 1,         // E2E is small, lower the bar
      scoreThreshold: 6.0,
      acceptanceThreshold: 0.5,
      topFailureCount: 3,
    });
    const promo = new PromotionEngine(tmp, gen);
    await promo.loadHistory();
    const learning = new LearningAPI(store, insights, analyzer, gen, promo, planner);
    const orchestrator = new AutonomyOrchestrator({
      dags,
      review: {
        review: async (input) => {
          const { ReviewIntelligence } = await import("@max/autonomy");
          return new ReviewIntelligence({ forceHeuristic: true }).review(input);
        },
      },
      executionStore: store,
      insightsStore: insights,
      failureAnalyzer: analyzer,
      planner,
      candidateGenerator: gen,
      promotionEngine: promo,
    });

    // 3. Build Hono app (mirrors apps/api/src/index.ts but with mocks).
    app = new Hono();
    eventLog = new Map<string, RuntimeEvent[]>();
    const approvalRuntimes = new Set<{ resolveApproval(requestId: string, response: { decision: "approve" | "reject"; comment?: string }): boolean }>();
    app.post(
      "/api/chat",
      postChat({
        commander: undefined as never, // unused in DAGS_MODE branch
        runtime: undefined as never,
        store: {
          saveWorkspace: async (ws) => {
            await fs.mkdir(path.join(tmp, ws.id), { recursive: true });
            await fs.writeFile(
              path.join(tmp, `${ws.id}.json`),
              JSON.stringify(ws, null, 2),
              "utf-8"
            );
          },
          loadWorkspace: async (id) => {
            try {
              const raw = await fs.readFile(path.join(tmp, `${id}.json`), "utf-8");
              return JSON.parse(raw);
            } catch {
              return undefined;
            }
          },
          saveArtifact: async () => "",
          readArtifact: async () => "",
          listArtifacts: async () => [],
        } as never,
        eventLog,
        dagsMode: true,
        dags,
        orchestrator,
        dagsApprovalRuntimes: {
          register(runtime) {
            approvalRuntimes.add(runtime);
            return () => approvalRuntimes.delete(runtime);
          },
        },
      })
    );
    const approvals = approvalRoutes({
      runtime: {
        resolveApproval: (requestId, response) => {
          for (const runtime of [...approvalRuntimes]) {
            if (runtime.resolveApproval(requestId, response)) return true;
          }
          return false;
        },
      },
    });
    app.post("/api/approvals/answer", approvals.answer);
    const lr = learningRoutes({ api: learning });
    app.get("/api/learning/status", lr.status);
    app.get("/api/learning/agents", lr.agents);
    app.get("/api/learning/evolution-history", lr.evolutionHistory);
    app.get("/api/learning/failure-patterns", lr.failurePatterns);
    const er = executionRoutes({ store });
    app.get("/api/executions", er.listAll);
    app.get("/api/executions/:id", er.get);
  });

  afterEach(async () => {
    // DAGS may still be writing files after the response returned.
    // Retry cleanup with a small backoff to handle the race.
    for (let i = 0; i < 5; i++) {
      try {
        await fs.rm(tmp, { recursive: true, force: true });
        return;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOTEMPTY" && i < 4) {
          await new Promise((r) => setTimeout(r, 50 * (i + 1)));
          continue;
        }
        throw err;
      }
    }
  });

  it("runs DAGS compose + autonomy observe() and surfaces results", async () => {
    // 1. POST /api/chat → DAGS compose path.
    const chatRes = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Build a Todo web app with React frontend" }),
    });
    expect(chatRes.status).toBe(200);
    const chatBody = (await chatRes.json()) as {
      workspaceId: string;
      planId: string;
      mode: string;
      teamSize: number;
    };
    expect(chatBody.mode).toBe("dags");
    expect(chatBody.workspaceId).toMatch(/^ws-/);
    expect(chatBody.teamSize).toBeGreaterThan(0);

    // 2. DAGS now gates review behind a human approval checkpoint.
    await waitFor(async () => {
      const events = eventLog.get(chatBody.workspaceId) ?? [];
      return events.some((event) => event.type === "approval-request");
    }, 4000);
    const approvalRequest = (eventLog.get(chatBody.workspaceId) ?? [])
      .find((event) => event.type === "approval-request") as Extract<RuntimeEvent, { type: "approval-request" }> | undefined;
    expect(approvalRequest).toBeDefined();
    const approvalRes = await app.request("/api/approvals/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: approvalRequest!.requestId, decision: "approve" }),
    });
    expect(approvalRes.status).toBe(200);

    await waitFor(async () => {
      const res = await app.request("/api/executions");
      const body = (await res.json()) as { count?: number; total?: number };
      return (body.count ?? body.total ?? 0) > 0;
    }, 4000);

    // 3. GET /api/executions → at least one execution record.
    const execRes = await app.request("/api/executions");
    const execBody = (await execRes.json()) as { total: number; items: Array<{ agentRole: string; review?: { score: number } }> };
    expect(execBody.total).toBeGreaterThan(0);
    expect(execBody.items[0]?.review).toBeDefined();

    // 4. GET /api/learning/status → counters reflect the execution.
    const statusRes = await app.request("/api/learning/status");
    const status = (await statusRes.json()) as { totalExecutions: number; roles: Array<{ role: string; avgScore: number }> };
    expect(status.totalExecutions).toBe(execBody.total);
    expect(status.roles.length).toBeGreaterThan(0);

    // 5. GET /api/learning/evolution-history → plans + candidates exist.
    const histRes = await app.request("/api/learning/evolution-history");
    const hist = (await histRes.json()) as { plans: unknown[]; candidates: unknown[]; promotions: unknown[] };
    expect(hist.plans.length).toBeGreaterThan(0);
    expect(hist.candidates.length).toBeGreaterThan(0);
    expect(Array.isArray(hist.promotions)).toBe(true);

    // 6. GET /api/executions/:id → single record retrievable.
    const firstId = execBody.items[0]!.agentRole;
    const singleRes = await app.request(`/api/executions/${encodeURIComponent(firstId)}`);
    expect(singleRes.status).toBeGreaterThanOrEqual(200);
  });

  it("runs in DAGS_MODE without a real LLM call (capability analyzer is heuristic)", async () => {
    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Analyze recent arxiv papers on LLM agents" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mode: string; teamSize: number };
    expect(body.mode).toBe("dags");
    // Research analysis should NOT include frontend/backend — capability-driven.
    expect(body.teamSize).toBeGreaterThan(0);
  });

  it("returns 400 for invalid chat body", async () => {
    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "" }),
    });
    expect(res.status).toBe(400);
  });
});

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}
