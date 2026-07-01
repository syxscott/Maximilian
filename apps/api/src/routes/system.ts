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
