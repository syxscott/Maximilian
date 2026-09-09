/**
 * System-level routes that benefit from being in the OpenAPI doc. Only
 * routes whose response shape is static and known up-front are registered
 * with `createRoute`; dynamic-shape endpoints (`/health`, `/ready`) keep
 * their `api.get(...)` form and stay documented in the README instead.
 */

import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { ProviderListResponseSchema } from "../schemas.js";

export const listProvidersRoute = createRoute({
  method: "get",
  path: "/providers",
  tags: ["system"],
  responses: {
    200: { content: { "application/json": { schema: ProviderListResponseSchema } }, description: "Available LLM providers" },
  },
});

export const healthRoute = createRoute({
  method: "get",
  path: "/health",
  tags: ["system"],
  responses: {
    200: { content: { "application/json": { schema: z.unknown() } }, description: "Healthy" },
    503: { content: { "application/json": { schema: z.unknown() } }, description: "Degraded or down" },
  },
});

export const readyRoute = createRoute({
  method: "get",
  path: "/ready",
  tags: ["system"],
  responses: {
    200: { content: { "application/json": { schema: z.unknown() } }, description: "Ready" },
    503: { content: { "application/json": { schema: z.unknown() } }, description: "Not ready" },
  },
});

export const setDefaultProviderRoute = createRoute({
  method: "put",
  path: "/system/providers/default",
  tags: ["system"],
  request: {
    body: { content: { "application/json": { schema: z.object({ providerId: z.string().min(1) }) } } },
  },
  responses: {
    200: { content: { "application/json": { schema: z.object({ ok: z.boolean(), providerId: z.string() }) } }, description: "Default provider updated" },
    404: { content: { "application/json": { schema: z.object({ error: z.string() }) } }, description: "Provider not found" },
    500: { content: { "application/json": { schema: z.object({ error: z.string() }) } }, description: "Internal error" },
  },
});

export const setProviderModelRoute = createRoute({
  method: "put",
  path: "/system/providers/{id}/model",
  tags: ["system"],
  request: {
    params: z.object({ id: z.string().min(1) }),
    body: { content: { "application/json": { schema: z.object({ model: z.string().min(1) }) } } },
  },
  responses: {
    200: { content: { "application/json": { schema: z.object({ ok: z.boolean(), providerId: z.string(), model: z.string() }) } }, description: "Default model updated" },
    404: { content: { "application/json": { schema: z.object({ error: z.string() }) } }, description: "Provider not found" },
    400: { content: { "application/json": { schema: z.object({ error: z.string() }) } }, description: "Invalid model" },
    500: { content: { "application/json": { schema: z.object({ error: z.string() }) } }, description: "Internal error" },
  },
});

// ── Circuit Breaker & Health (borrowed from cc-switch) ───────────────────────

export const providerHealthRoute = createRoute({
  method: "get",
  path: "/system/providers/{id}/health",
  tags: ["system"],
  request: { params: z.object({ id: z.string().min(1) }) },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            status: z.enum(["healthy", "degraded", "down", "unknown"]),
            latencyMs: z.number().nonnegative().optional(),
            errorMessage: z.string().optional(),
            lastCheckedAt: z.number().int().positive().optional(),
          }),
        },
      },
      description: "Provider health status",
    },
    404: { content: { "application/json": { schema: z.object({ error: z.string() }) } }, description: "Provider not found" },
  },
});

export const circuitBreakerStatsRoute = createRoute({
  method: "get",
  path: "/system/providers/{id}/circuit-breaker/stats",
  tags: ["system"],
  request: { params: z.object({ id: z.string().min(1) }) },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            state: z.enum(["closed", "open", "half-open"]),
            failures: z.number().int().nonnegative(),
            lastFailureAt: z.number().int().positive().optional(),
            probeInFlight: z.boolean().optional(),
          }),
        },
      },
      description: "Circuit breaker statistics",
    },
    404: { content: { "application/json": { schema: z.object({ error: z.string() }) } }, description: "Provider not found" },
  },
});

export const circuitBreakerResetRoute = createRoute({
  method: "post",
  path: "/system/providers/{id}/circuit-breaker/reset",
  tags: ["system"],
  request: { params: z.object({ id: z.string().min(1) }) },
  responses: {
    200: { content: { "application/json": { schema: z.object({ ok: z.boolean(), providerId: z.string() }) } }, description: "Circuit breaker reset" },
    404: { content: { "application/json": { schema: z.object({ error: z.string() }) } }, description: "Provider not found" },
  },
});

// ── Failover Queue (borrowed from cc-switch) ─────────────────────────────────

export const failoverQueueRoute = createRoute({
  method: "get",
  path: "/system/failover/queue",
  tags: ["system"],
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            queue: z.array(z.object({
              providerId: z.string(),
              priority: z.number().int().positive(),
              addedAt: z.number().int().positive(),
            })),
          }),
        },
      },
      description: "Failover queue",
    },
  },
});

export const failoverQueueAddRoute = createRoute({
  method: "post",
  path: "/system/failover/queue/add",
  tags: ["system"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            providerId: z.string().min(1),
            priority: z.number().int().positive().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: { content: { "application/json": { schema: z.object({ ok: z.boolean(), providerId: z.string() }) } }, description: "Provider added to failover queue" },
    404: { content: { "application/json": { schema: z.object({ error: z.string() }) } }, description: "Provider not found" },
  },
});

export const failoverQueueRemoveRoute = createRoute({
  method: "post",
  path: "/system/failover/queue/remove",
  tags: ["system"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({ providerId: z.string().min(1) }),
        },
      },
    },
  },
  responses: {
    200: { content: { "application/json": { schema: z.object({ ok: z.boolean(), providerId: z.string() }) } }, description: "Provider removed from failover queue" },
  },
});

export const autoFailoverRoute = createRoute({
  method: "get",
  path: "/system/failover/auto",
  tags: ["system"],
  responses: {
    200: { content: { "application/json": { schema: z.object({ enabled: z.boolean() }) } }, description: "Auto-failover state" },
  },
});

export const setAutoFailoverRoute = createRoute({
  method: "put",
  path: "/system/failover/auto",
  tags: ["system"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({ enabled: z.boolean() }),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ ok: z.boolean(), enabled: z.boolean() }),
        },
      },
      description: "Auto-failover updated",
    },
  },
})
