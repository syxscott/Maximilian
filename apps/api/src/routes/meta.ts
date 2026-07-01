/**
 * Phase 6 — Meta-System HTTP routes.
 *
 *   GET  /api/meta/capabilities         List all capability records
 *   GET  /api/meta/capabilities/:id     Get a capability by id
 *   GET  /api/meta/proposals            List capability proposals
 *   POST /api/meta/cycle                Run one meta-system cycle
 *   GET  /api/meta/events               Organization event timeline
 *   GET  /api/meta/events/count         Event counts by type
 *   POST /api/meta/governance/check     Check governance verdict
 *   POST /api/meta/simulate             Simulate an org structure
 *   POST /api/meta/simulate/compare     Compare two org structures
 *   GET  /api/meta/governance/config    Read governance config
 *   PUT  /api/meta/governance/config    Update governance config
 */

import { createRoute } from "@hono/zod-openapi";
import type { Context } from "hono";
import { z } from "zod";

import type { ExecutionRecord } from "@max/autonomy";
import type { TeamGraph, AgentBlueprint } from "@max/dags";
import { PaginationQuerySchema, paginate, type PaginationQuery } from "../lib/pagination.js";
import {
  GovernanceEngine,
  MetaOrchestrator,
  OrganizationMemory,
  SimulationEngine,
  CapabilityRegistry,
  CapabilityDiscoveryEngine,
  type CapabilityRecord,
  type DiscoverySignal,
  type MetaCycleInput,
  type RoleProfile,
} from "@max/meta-system";
import { ErrorSchema } from "../schemas.js";

const DiscoverySignalSchema = z.object({
  text: z.string().min(1),
  context: z.string().default(""),
  source: z.enum([
    "user_request_analysis",
    "failure_pattern_mining",
    "review_suggestion",
    "capability_gap",
  ]),
});

const CycleRequestSchema = z.object({
  recentExecutions: z.array(z.unknown()).default([]),
  blueprints: z.array(z.unknown()).default([]),
  graphs: z.array(z.unknown()).default([]),
  discoverySignals: z.array(DiscoverySignalSchema).default([]),
});

const SimulateRequestSchema = z.object({
  orgName: z.string(),
  graph: z.unknown(),
  profiles: z.record(
    z.object({
      costPerCall: z.number(),
      latencyMs: z.number(),
      qualityScore: z.number(),
    })
  ),
  serialDepth: z.number().optional(),
});

const CompareRequestSchema = z.object({
  a: SimulateRequestSchema,
  b: SimulateRequestSchema,
});

const GovernanceConfigSchema = z.object({
  maxAgents: z.number().int().positive(),
  maxCapabilities: z.number().int().positive(),
  maxDepth: z.number().int().positive(),
  requireReviewForBirth: z.boolean(),
  minUsageForBirth: z.number().int().nonnegative(),
  hitlRiskThreshold: z.number().min(0).max(1).default(0.4),
  hitlAlwaysForActions: z.array(z.string()).default(["retire"]),
});

const IdParamsSchema = z.object({ id: z.string().min(1) });

// ── OpenAPI route definitions ─────────────────────────────────────────────

export const listCapabilitiesRoute = createRoute({
  method: "get",
  path: "/meta/capabilities",
  tags: ["meta"],
  responses: {
    200: { content: { "application/json": { schema: z.unknown() } }, description: "Paginated capabilities" },
  },
});

export const getCapabilityRoute = createRoute({
  method: "get",
  path: "/meta/capabilities/{id}",
  tags: ["meta"],
  request: { params: IdParamsSchema },
  responses: {
    200: { content: { "application/json": { schema: z.unknown() } }, description: "Capability" },
    404: { content: { "application/json": { schema: ErrorSchema } }, description: "Not found" },
  },
});

export const listProposalsRoute = createRoute({
  method: "get",
  path: "/meta/proposals",
  tags: ["meta"],
  responses: {
    200: { content: { "application/json": { schema: z.unknown() } }, description: "Capability proposals" },
  },
});

export const runCycleRoute = createRoute({
  method: "post",
  path: "/meta/cycle",
  tags: ["meta"],
  request: { body: { content: { "application/json": { schema: CycleRequestSchema } } } },
  responses: {
    200: { content: { "application/json": { schema: z.unknown() } }, description: "Cycle result" },
    400: { content: { "application/json": { schema: ErrorSchema } }, description: "Bad request" },
  },
});

export const listEventsRoute = createRoute({
  method: "get",
  path: "/meta/events",
  tags: ["meta"],
  responses: {
    200: { content: { "application/json": { schema: z.unknown() } }, description: "Paginated events" },
  },
});

export const countEventsRoute = createRoute({
  method: "get",
  path: "/meta/events/count",
  tags: ["meta"],
  responses: {
    200: { content: { "application/json": { schema: z.unknown() } }, description: "Event counts by type" },
  },
});

export const checkGovernanceRoute = createRoute({
  method: "post",
  path: "/meta/governance/check",
  tags: ["meta"],
  request: { body: { content: { "application/json": { schema: z.object({ graphs: z.array(z.unknown()).optional(), capabilities: z.array(z.unknown()).optional(), blueprints: z.array(z.unknown()).optional() }) } } } },
  responses: {
    200: { content: { "application/json": { schema: z.unknown() } }, description: "Governance verdict" },
  },
});

export const simulateRoute = createRoute({
  method: "post",
  path: "/meta/simulate",
  tags: ["meta"],
  request: { body: { content: { "application/json": { schema: SimulateRequestSchema } } } },
  responses: {
    200: { content: { "application/json": { schema: z.unknown() } }, description: "Simulation result" },
    400: { content: { "application/json": { schema: ErrorSchema } }, description: "Bad request" },
  },
});

export const compareSimulationsRoute = createRoute({
  method: "post",
  path: "/meta/simulate/compare",
  tags: ["meta"],
  request: { body: { content: { "application/json": { schema: CompareRequestSchema } } } },
  responses: {
    200: { content: { "application/json": { schema: z.unknown() } }, description: "Comparison result" },
    400: { content: { "application/json": { schema: ErrorSchema } }, description: "Bad request" },
  },
});

export const getGovernanceConfigRoute = createRoute({
  method: "get",
  path: "/meta/governance/config",
  tags: ["meta"],
  responses: {
    200: { content: { "application/json": { schema: GovernanceConfigSchema } }, description: "Governance config" },
  },
});

export const putGovernanceConfigRoute = createRoute({
  method: "put",
  path: "/meta/governance/config",
  tags: ["meta"],
  request: { body: { content: { "application/json": { schema: GovernanceConfigSchema } } } },
  responses: {
    200: { content: { "application/json": { schema: z.object({ ok: z.boolean(), config: GovernanceConfigSchema }) } }, description: "Config updated" },
    400: { content: { "application/json": { schema: ErrorSchema } }, description: "Bad request" },
  },
});

interface MetaRouteDeps {
  orchestrator: MetaOrchestrator;
  governance: GovernanceEngine;
  organizationMemory: OrganizationMemory;
  simulation: SimulationEngine;
  registry: CapabilityRegistry;
  discovery: CapabilityDiscoveryEngine;
}

export function metaRoutes(deps: MetaRouteDeps) {
  const { orchestrator, governance, organizationMemory, simulation, registry, discovery } = deps;

  function parsePagination(c: Context): PaginationQuery {
    const raw = c.req.query();
    const parsed = PaginationQuerySchema.safeParse({
      cursor: raw.cursor,
      limit: raw.limit,
    });
    if (!parsed.success) return { cursor: undefined, limit: 20 };
    return parsed.data;
  }

  return {
    listCapabilities: async (c: Context) => {
      const all = await registry.listAll();
      const page = paginate(all, parsePagination(c), (cap) => cap.id);
      return c.json({
        count: page.items.length,
        capabilities: page.items,
        nextCursor: page.nextCursor,
        total: page.total,
      });
    },

    getCapability: async (c: Context) => {
      const id = c.req.param("id");
      if (!id) return c.json({ error: "not_found" }, 404);
      const rec = await registry.get(id);
      if (!rec) return c.json({ error: "not_found" }, 404);
      return c.json(rec);
    },

    listProposals: async (c: Context) => {
      const all = await discovery.listProposals();
      return c.json({ count: all.length, proposals: all });
    },

    runCycle: async (c: Context) => {
      const body = c.req.valid("json" as never) as {
        recentExecutions: unknown[];
        blueprints: unknown[];
        graphs: unknown[];
        discoverySignals: DiscoverySignal[];
      };
      const input: MetaCycleInput = {
        recentExecutions: body.recentExecutions as ExecutionRecord[],
        blueprints: body.blueprints as AgentBlueprint[],
        graphs: body.graphs as TeamGraph[],
        discoverySignals: body.discoverySignals as DiscoverySignal[],
      };
      const result = await orchestrator.cycle(input);
      return c.json(result);
    },

    listEvents: async (c: Context) => {
      const subject = c.req.query("subject");
      const events = subject
        ? await organizationMemory.timeline(subject)
        : await organizationMemory.listAll();
      const page = paginate(events, parsePagination(c), (e) => e.id);
      return c.json({
        count: page.items.length,
        events: page.items,
        nextCursor: page.nextCursor,
        total: page.total,
      });
    },

    countEvents: async (c: Context) => {
      const counts = await organizationMemory.countByType();
      return c.json(counts);
    },

    checkGovernance: async (c: Context) => {
      const body = await c.req.json().catch(() => ({}));
      const verdict = governance.check({
        graphs: (body.graphs ?? []) as TeamGraph[],
        capabilities: (body.capabilities ?? []) as CapabilityRecord[],
        blueprints: (body.blueprints ?? []) as AgentBlueprint[],
      });
      return c.json(verdict);
    },

    simulate: async (c: Context) => {
      const body = c.req.valid("json" as never) as {
        orgName: string;
        graph: unknown;
        profiles: Record<string, RoleProfile>;
        serialDepth?: number;
      };
      const result = await simulation.simulate({
        orgName: body.orgName,
        graph: body.graph as TeamGraph,
        profiles: body.profiles as Record<string, RoleProfile>,
        serialDepth: body.serialDepth,
      });
      return c.json(result);
    },

    compareSimulations: async (c: Context) => {
      const body = c.req.valid("json" as never) as {
        a: { orgName: string; graph: unknown; profiles: Record<string, RoleProfile>; serialDepth?: number };
        b: { orgName: string; graph: unknown; profiles: Record<string, RoleProfile>; serialDepth?: number };
      };
      const result = await simulation.compare(
        {
          orgName: body.a.orgName,
          graph: body.a.graph as TeamGraph,
          profiles: body.a.profiles as Record<string, RoleProfile>,
          serialDepth: body.a.serialDepth,
        },
        {
          orgName: body.b.orgName,
          graph: body.b.graph as TeamGraph,
          profiles: body.b.profiles as Record<string, RoleProfile>,
          serialDepth: body.b.serialDepth,
        }
      );
      return c.json(result);
    },

    getGovernanceConfig: async (c: Context) => {
      const cfg = await governance.loadConfig();
      return c.json(cfg);
    },

    putGovernanceConfig: async (c: Context) => {
      const body = c.req.valid("json" as never) as z.infer<typeof GovernanceConfigSchema>;
      await governance.saveConfig(body);
      return c.json({ ok: true, config: body });
    },
  };
}