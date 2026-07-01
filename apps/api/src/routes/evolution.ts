/**
 * Evolution Engine HTTP routes.
 *
 *   GET  /api/evolution/metrics         All recorded metrics
 *   GET  /api/evolution/metrics/:taskId One metric record
 *   GET  /api/evolution/agents          All agent profiles
 *   GET  /api/evolution/agents/:role    One agent profile
 *   GET  /api/evolution/leaderboard     Aggregated leaderboard
 *   GET  /api/evolution/leaderboard/:role  Per-role leaderboard
 *   GET  /api/evolution/versions/:role  All version snapshots
 *   GET  /api/evolution/versions/:role/decisions  Evolution history
 *   POST /api/evolution/feedback        Record user feedback
 *   POST /api/evolution/evolve/:role    Trigger evolution cycle
 */

import { createRoute } from "@hono/zod-openapi";
import type { Context } from "hono";
import { z } from "zod";
import type { AgentRole } from "@max/core";
import { AgentRole as AgentRoleSchema } from "@max/core";
import type { EvolutionFacade } from "@max/evolution";
import { PaginationQuerySchema, paginate, type PaginationQuery } from "../lib/pagination.js";
import { ErrorSchema } from "../schemas.js";

interface Deps {
  facade: EvolutionFacade;
}

const FeedbackSchema = z.object({
  role: AgentRoleSchema,
  text: z.string().min(1).max(2000),
});

const RoleParamsSchema = z.object({ role: z.string().min(1) });
const TaskIdParamsSchema = z.object({ taskId: z.string().min(1) });

// ── OpenAPI route definitions ─────────────────────────────────────────────

export const listMetricsRoute = createRoute({
  method: "get",
  path: "/evolution/metrics",
  tags: ["evolution"],
  responses: {
    200: { content: { "application/json": { schema: z.object({ metrics: z.array(z.unknown()), nextCursor: z.string().nullable(), total: z.number() }) } }, description: "Paginated metrics" },
  },
});

export const getMetricRoute = createRoute({
  method: "get",
  path: "/evolution/metrics/{taskId}",
  tags: ["evolution"],
  request: { params: TaskIdParamsSchema },
  responses: {
    200: { content: { "application/json": { schema: z.unknown() } }, description: "Metric record" },
    400: { content: { "application/json": { schema: ErrorSchema } }, description: "Missing taskId" },
    404: { content: { "application/json": { schema: ErrorSchema } }, description: "Metric not found" },
  },
});

export const listAgentsRoute = createRoute({
  method: "get",
  path: "/evolution/agents",
  tags: ["evolution"],
  responses: {
    200: { content: { "application/json": { schema: z.object({ profiles: z.array(z.unknown()), nextCursor: z.string().nullable(), total: z.number() }) } }, description: "Paginated agent profiles" },
  },
});

export const getAgentRoute = createRoute({
  method: "get",
  path: "/evolution/agents/{role}",
  tags: ["evolution"],
  request: { params: RoleParamsSchema },
  responses: {
    200: { content: { "application/json": { schema: z.unknown() } }, description: "Agent profile" },
    400: { content: { "application/json": { schema: ErrorSchema } }, description: "Missing role" },
    404: { content: { "application/json": { schema: ErrorSchema } }, description: "Profile not found" },
  },
});

export const leaderboardRoute = createRoute({
  method: "get",
  path: "/evolution/leaderboard",
  tags: ["evolution"],
  responses: {
    200: { content: { "application/json": { schema: z.unknown() } }, description: "Leaderboard" },
  },
});

export const leaderboardForRoleRoute = createRoute({
  method: "get",
  path: "/evolution/leaderboard/{role}",
  tags: ["evolution"],
  request: { params: RoleParamsSchema },
  responses: {
    200: { content: { "application/json": { schema: z.unknown() } }, description: "Per-role leaderboard" },
    400: { content: { "application/json": { schema: ErrorSchema } }, description: "Missing role" },
  },
});

export const listVersionsRoute = createRoute({
  method: "get",
  path: "/evolution/versions/{role}",
  tags: ["evolution"],
  request: { params: RoleParamsSchema },
  responses: {
    200: { content: { "application/json": { schema: z.unknown() } }, description: "Version snapshots" },
    400: { content: { "application/json": { schema: ErrorSchema } }, description: "Missing role" },
  },
});

export const listDecisionsRoute = createRoute({
  method: "get",
  path: "/evolution/versions/{role}/decisions",
  tags: ["evolution"],
  request: { params: RoleParamsSchema },
  responses: {
    200: { content: { "application/json": { schema: z.unknown() } }, description: "Evolution decisions" },
    400: { content: { "application/json": { schema: ErrorSchema } }, description: "Missing role" },
  },
});

export const recordFeedbackRoute = createRoute({
  method: "post",
  path: "/evolution/feedback",
  tags: ["evolution"],
  request: { body: { content: { "application/json": { schema: FeedbackSchema } } } },
  responses: {
    200: { content: { "application/json": { schema: z.object({ ok: z.boolean(), totalFeedback: z.number() }) } }, description: "Feedback recorded" },
    400: { content: { "application/json": { schema: ErrorSchema } }, description: "Invalid body" },
  },
});

export const triggerEvolveRoute = createRoute({
  method: "post",
  path: "/evolution/evolve/{role}",
  tags: ["evolution"],
  request: { params: RoleParamsSchema },
  responses: {
    200: { content: { "application/json": { schema: z.unknown() } }, description: "Evolution decision" },
    400: { content: { "application/json": { schema: ErrorSchema } }, description: "Missing role" },
    404: { content: { "application/json": { schema: ErrorSchema } }, description: "No profile/manifest for role" },
  },
});

function parsePagination(c: Context): PaginationQuery {
  const raw = c.req.query();
  const parsed = PaginationQuerySchema.safeParse({
    cursor: raw.cursor,
    limit: raw.limit,
  });
  if (!parsed.success) {
    return { cursor: undefined, limit: 20 };
  }
  return parsed.data;
}

export function evolutionRoutes(deps: Deps) {
  const { facade } = deps;

  return {
    listMetrics: async (c: Context) => {
      const all = await facade.metrics.listAll();
      const page = paginate(all, parsePagination(c), (m) => m.taskId);
      return c.json({ count: page.items.length, metrics: page.items, nextCursor: page.nextCursor, total: page.total });
    },

    getMetric: async (c: Context) => {
      const taskId = c.req.param("taskId");
      if (!taskId) return c.json({ error: "Missing taskId" }, 400);
      const m = await facade.metrics.get(taskId);
      if (!m) return c.json({ error: "Metric not found" }, 404);
      return c.json(m);
    },

    listAgents: async (c: Context) => {
      const profiles = await facade.profiles.listAll();
      const page = paginate(profiles, parsePagination(c), (p) => p.role);
      return c.json({ count: page.items.length, profiles: page.items, nextCursor: page.nextCursor, total: page.total });
    },

    getAgent: async (c: Context) => {
      const role = c.req.param("role") as AgentRole | undefined;
      if (!role) return c.json({ error: "Missing role" }, 400);
      const p = await facade.profiles.get(role);
      if (!p) return c.json({ error: "Profile not found" }, 404);
      return c.json(p);
    },

    leaderboard: async (c: Context) => {
      await facade.leaderboard.rebuild(facade.metrics);
      return c.json(facade.leaderboard.toJSON());
    },

    leaderboardForRole: async (c: Context) => {
      const role = c.req.param("role") as AgentRole | undefined;
      if (!role) return c.json({ error: "Missing role" }, 400);
      await facade.leaderboard.rebuild(facade.metrics);
      return c.json({ role, entries: facade.leaderboard.entriesFor(role) });
    },

    listVersions: async (c: Context) => {
      const role = c.req.param("role") as AgentRole | undefined;
      if (!role) return c.json({ error: "Missing role" }, 400);
      const versions = await facade.evolution.listVersions(role);
      return c.json({ role, versions });
    },

    listDecisions: async (c: Context) => {
      const role = c.req.param("role") as AgentRole | undefined;
      if (!role) return c.json({ error: "Missing role" }, 400);
      const decisions = await readDecisions(facade, role);
      return c.json({ role, decisions });
    },

    recordFeedback: async (c: Context) => {
      const body = c.req.valid("json" as never) as { role: AgentRole; text: string };
      const profile = await facade.activeProfile(body.role);
      const { AgentMemoryStore } = await import("@max/evolution");
      const next = AgentMemoryStore.recordFeedback(profile.memory, body.text);
      const compressed = await AgentMemoryStore.maybeCompress(next);
      await facade.profiles.save({ ...profile, memory: compressed });
      return c.json({ ok: true, totalFeedback: compressed.userFeedback.length });
    },

    triggerEvolve: async (c: Context) => {
      const role = c.req.param("role") as AgentRole | undefined;
      if (!role) return c.json({ error: "Missing role" }, 400);
      const profile = await facade.profiles.get(role);
      if (!profile?.manifest) {
        return c.json({ error: "No profile or manifest for role" }, 404);
      }
      const decision = await facade.evolution.evolve(role, profile.manifest);
      return c.json(decision);
    },
  };
}

async function readDecisions(facade: EvolutionFacade, role: AgentRole) {
  // Delegate to evolution engine's own read; kept here so the API surface
  // doesn't leak storage paths.
  const versions = await facade.evolution.listVersions(role);
  return versions;
}
