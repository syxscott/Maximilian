/**
 * Feature Flag SDK — HTTP API.
 *
 * Customers can read & override feature flags at runtime, without
 * waiting for a server restart. Internally backed by the same
 * `FeatureFlags` instance the rest of the API uses.
 *
 * Endpoints:
 *   GET    /api/flags                     — list all flag definitions
 *   GET    /api/flags/:name               — get one flag (with current value)
 *   POST   /api/flags/:name/override      — set a runtime override
 *   DELETE /api/flags/:name/override      — clear a runtime override
 *   POST   /api/flags/evaluate            — bulk-evaluate a set of flags
 *
 * The SDK package (`packages/sdk`) wraps these calls so customer code
 * never has to talk HTTP directly.
 */

import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import type { FeatureFlags } from "@max/config";
import { createFeatureFlags } from "@max/config";

const FlagValueResponse = z.object({
  name: z.string(),
  enabled: z.boolean(),
  defaultValue: z.boolean(),
  rolloutPercentage: z.number().optional(),
  description: z.string().optional(),
});

const FlagListResponse = z.object({
  flags: z.array(FlagValueResponse),
});

const EvaluateRequest = z.object({
  flagNames: z.array(z.string()).min(1).max(50),
  userId: z.string().optional(),
});

const EvaluateResponse = z.object({
  values: z.record(z.string(), z.boolean()),
});

const OverrideRequest = z.object({
  value: z.boolean(),
  reason: z.string().optional(),
});

const OverrideResponse = z.object({
  flagName: z.string(),
  value: z.boolean(),
  overriddenBy: z.string().optional(),
  overriddenAt: z.string(),
});

let _flags: FeatureFlags | null = null;

function getFlags(): FeatureFlags {
  if (!_flags) {
    _flags = createFeatureFlags({ loadFromEnv: true });
  }
  return _flags;
}

/** Replace the singleton (for testing). */
export function __setFeatureFlagsForTests(f: FeatureFlags | null): void {
  _flags = f;
}

export const listFlagsRoute = createRoute({
  method: "get",
  path: "/flags",
  tags: ["feature-flags"],
  responses: {
    200: {
      content: { "application/json": { schema: FlagListResponse } },
      description: "List all flag definitions with current values",
    },
  },
});

export const getFlagRoute = createRoute({
  method: "get",
  path: "/flags/{name}",
  tags: ["feature-flags"],
  request: { params: z.object({ name: z.string() }) },
  responses: {
    200: {
      content: { "application/json": { schema: FlagValueResponse } },
      description: "Flag value",
    },
    404: { description: "Unknown flag" },
  },
});

export const setOverrideRoute = createRoute({
  method: "post",
  path: "/flags/{name}/override",
  tags: ["feature-flags"],
  request: {
    params: z.object({ name: z.string() }),
    body: { content: { "application/json": { schema: OverrideRequest } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: OverrideResponse } },
      description: "Override applied",
    },
    404: { description: "Unknown flag" },
  },
});

export const clearOverrideRoute = createRoute({
  method: "delete",
  path: "/flags/{name}/override",
  tags: ["feature-flags"],
  request: { params: z.object({ name: z.string() }) },
  responses: {
    204: { description: "Override cleared" },
    404: { description: "Unknown flag" },
  },
});

export const evaluateRoute = createRoute({
  method: "post",
  path: "/flags/evaluate",
  tags: ["feature-flags"],
  request: {
    body: { content: { "application/json": { schema: EvaluateRequest } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: EvaluateResponse } },
      description: "Evaluated flag values",
    },
  },
});

export { getFlags };