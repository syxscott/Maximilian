/**
 * Phase 5.7 — Learning Dashboard HTTP routes.
 *
 *   GET   /api/learning/status              Aggregate counts and per-role stats
 *   GET   /api/learning/agents              Per-role agent summary
 *   GET   /api/learning/evolution-history   Plans + promotions + candidates
 *   GET   /api/learning/failure-patterns    Mined failure insights
 *   POST  /api/learning/mine-failure-patterns  On-demand re-mine
 */

import { createRoute } from "@hono/zod-openapi";
import type { Context } from "hono";
import { z } from "zod";
import type { LearningAPI } from "@max/autonomy";
import { ErrorSchema } from "../schemas.js";

interface Deps {
  api: LearningAPI;
}

// ── OpenAPI route definitions ─────────────────────────────────────────────

export const learningStatusRoute = createRoute({
  method: "get",
  path: "/learning/status",
  tags: ["learning"],
  responses: {
    200: { content: { "application/json": { schema: z.unknown() } }, description: "Aggregate learning status" },
  },
});

export const learningAgentsRoute = createRoute({
  method: "get",
  path: "/learning/agents",
  tags: ["learning"],
  responses: {
    200: { content: { "application/json": { schema: z.unknown() } }, description: "Per-role agent summary" },
  },
});

export const learningEvolutionHistoryRoute = createRoute({
  method: "get",
  path: "/learning/evolution-history",
  tags: ["learning"],
  responses: {
    200: { content: { "application/json": { schema: z.unknown() } }, description: "Evolution history" },
  },
});

export const learningFailurePatternsRoute = createRoute({
  method: "get",
  path: "/learning/failure-patterns",
  tags: ["learning"],
  responses: {
    200: { content: { "application/json": { schema: z.unknown() } }, description: "Mined failure patterns" },
  },
});

export const learningMineFailurePatternsRoute = createRoute({
  method: "post",
  path: "/learning/mine-failure-patterns",
  tags: ["learning"],
  responses: {
    200: { content: { "application/json": { schema: z.unknown() } }, description: "Freshly mined patterns" },
    500: { content: { "application/json": { schema: ErrorSchema } }, description: "Failure analyzer not wired" },
  },
});

export function learningRoutes(deps: Deps) {
  const { api } = deps;

  return {
    status: async (c: Context) => {
      const status = await api.status();
      return c.json(status);
    },

    agents: async (c: Context) => {
      const agents = await api.agents();
      return c.json({ count: agents.length, agents });
    },

    evolutionHistory: async (c: Context) => {
      const history = await api.evolutionHistory();
      return c.json(history);
    },

    failurePatterns: async (c: Context) => {
      const patterns = await api.failurePatterns();
      return c.json({ count: patterns.length, patterns });
    },

    mineFailurePatterns: async (c: Context) => {
      // On-demand re-mine: useful for kicking the FailurePatternAnalyzer
      // without waiting for a workspace to complete.
      const analyzer = api.getFailureAnalyzer();
      const executions = (analyzer as unknown as { executions?: unknown }).executions;
      if (!executions) {
        return c.json({ error: "Failure analyzer not wired to a store" }, 500);
      }
      const patterns = await analyzer.analyze(executions as never);
      await analyzer.leaderboardInsight(executions as never);
      return c.json({ count: patterns.length, patterns });
    },
  };
}
