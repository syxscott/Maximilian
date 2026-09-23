/**
 * System-level routes that benefit from being in the OpenAPI doc. Only
 * routes whose response shape is static and known up-front are registered
 * with `createRoute`; dynamic-shape endpoints (`/health`, `/ready`) keep
 * their `api.get(...)` form and stay documented in the README instead.
 */

import { createRoute } from "@hono/zod-openapi"
import { z } from "zod"
import { ProviderListResponseSchema } from "../schemas.js"
import { VISIBLE_PROVIDER_PRESETS } from "@max/providers"
import type { ProviderRegistry } from "@max/providers"
import type { Context } from "hono"

export const listProvidersRoute = createRoute({
  method: "get",
  path: "/providers",
  tags: ["system"],
  responses: {
    200: {
      content: { "application/json": { schema: ProviderListResponseSchema } },
      description: "Available LLM providers",
    },
  },
})

export const healthRoute = createRoute({
  method: "get",
  path: "/health",
  tags: ["system"],
  responses: {
    200: { content: { "application/json": { schema: z.unknown() } }, description: "Healthy" },
    503: {
      content: { "application/json": { schema: z.unknown() } },
      description: "Degraded or down",
    },
  },
})

export const readyRoute = createRoute({
  method: "get",
  path: "/ready",
  tags: ["system"],
  responses: {
    200: { content: { "application/json": { schema: z.unknown() } }, description: "Ready" },
    503: { content: { "application/json": { schema: z.unknown() } }, description: "Not ready" },
  },
})

export const setDefaultProviderRoute = createRoute({
  method: "put",
  path: "/system/providers/default",
  tags: ["system"],
  request: {
    body: {
      content: { "application/json": { schema: z.object({ providerId: z.string().min(1) }) } },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: z.object({ ok: z.boolean(), providerId: z.string() }) },
      },
      description: "Default provider updated",
    },
    404: {
      content: { "application/json": { schema: z.object({ error: z.string() }) } },
      description: "Provider not found",
    },
    500: {
      content: { "application/json": { schema: z.object({ error: z.string() }) } },
      description: "Internal error",
    },
  },
})

export const setProviderModelRoute = createRoute({
  method: "put",
  path: "/system/providers/{id}/model",
  tags: ["system"],
  request: {
    params: z.object({ id: z.string().min(1) }),
    body: { content: { "application/json": { schema: z.object({ model: z.string().min(1) }) } } },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ ok: z.boolean(), providerId: z.string(), model: z.string() }),
        },
      },
      description: "Default model updated",
    },
    404: {
      content: { "application/json": { schema: z.object({ error: z.string() }) } },
      description: "Provider not found",
    },
    400: {
      content: { "application/json": { schema: z.object({ error: z.string() }) } },
      description: "Invalid model",
    },
    500: {
      content: { "application/json": { schema: z.object({ error: z.string() }) } },
      description: "Internal error",
    },
  },
})

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
    404: {
      content: { "application/json": { schema: z.object({ error: z.string() }) } },
      description: "Provider not found",
    },
  },
})

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
    404: {
      content: { "application/json": { schema: z.object({ error: z.string() }) } },
      description: "Provider not found",
    },
  },
})

export const circuitBreakerResetRoute = createRoute({
  method: "post",
  path: "/system/providers/{id}/circuit-breaker/reset",
  tags: ["system"],
  request: { params: z.object({ id: z.string().min(1) }) },
  responses: {
    200: {
      content: {
        "application/json": { schema: z.object({ ok: z.boolean(), providerId: z.string() }) },
      },
      description: "Circuit breaker reset",
    },
    404: {
      content: { "application/json": { schema: z.object({ error: z.string() }) } },
      description: "Provider not found",
    },
  },
})

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
            queue: z.array(
              z.object({
                providerId: z.string(),
                priority: z.number().int().positive(),
                addedAt: z.number().int().positive(),
              }),
            ),
          }),
        },
      },
      description: "Failover queue",
    },
  },
})

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
    200: {
      content: {
        "application/json": { schema: z.object({ ok: z.boolean(), providerId: z.string() }) },
      },
      description: "Provider added to failover queue",
    },
    404: {
      content: { "application/json": { schema: z.object({ error: z.string() }) } },
      description: "Provider not found",
    },
  },
})

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
    200: {
      content: {
        "application/json": { schema: z.object({ ok: z.boolean(), providerId: z.string() }) },
      },
      description: "Provider removed from failover queue",
    },
  },
})

export const autoFailoverRoute = createRoute({
  method: "get",
  path: "/system/failover/auto",
  tags: ["system"],
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ enabled: z.boolean() }) } },
      description: "Auto-failover state",
    },
  },
})

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

// ── Settings deep domains (read-only surfaces for the dashboard) ────────────
//
// Three endpoints backing the settings center's deep management domains
// (admin-status.ts borrowing: exported handler factories, wiring lives in
// src/index.ts next to the other system routes):
//
//   GET  /system/provider-presets         curated preset catalog (no secrets)
//   POST /system/providers/{id}/test-chat one-round chat probe (diagnostic)
//   GET  /system/session-store            SQLite side-store status + row counts

const ProviderPresetSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  apiFormat: z.string(),
  defaultModel: z.string(),
  baseUrl: z.string(),
  /** Env var NAME only — the key value itself never crosses the wire. */
  envKey: z.string(),
  envModel: z.string().nullable(),
  /** True when the env var named by `envKey` is set in this process. */
  configured: z.boolean(),
  isOfficial: z.boolean(),
  isPartner: z.boolean(),
})

export const providerPresetsRoute = createRoute({
  method: "get",
  path: "/system/provider-presets",
  tags: ["system"],
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            presets: z.array(ProviderPresetSummarySchema),
            total: z.number().int().nonnegative(),
          }),
        },
      },
      description: "Visible provider preset catalog (metadata only, no secrets)",
    },
  },
})

export function providerPresetsHandler() {
  return async (_c: Context) => {
    const presets = VISIBLE_PROVIDER_PRESETS.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      apiFormat: p.apiFormat,
      defaultModel: p.defaultModel,
      baseUrl: p.baseUrl,
      envKey: p.envKey,
      envModel: p.envModel ?? null,
      configured: Boolean(process.env[p.envKey]),
      isOfficial: p.isOfficial ?? false,
      isPartner: p.isPartner ?? false,
    }))
    return Response.json({ presets, total: presets.length })
  }
}

export const providerTestChatRoute = createRoute({
  method: "post",
  path: "/system/providers/{id}/test-chat",
  tags: ["system"],
  request: {
    params: z.object({ id: z.string().min(1) }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            prompt: z.string().min(1).max(4000),
            model: z.string().min(1).max(200).optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            ok: z.literal(true),
            providerId: z.string(),
            model: z.string(),
            content: z.string(),
            durationMs: z.number().nonnegative(),
            usage: z
              .object({
                promptTokens: z.number(),
                completionTokens: z.number(),
                totalTokens: z.number(),
              })
              .optional(),
          }),
        },
      },
      description: "One-round chat probe succeeded",
    },
    400: {
      content: { "application/json": { schema: z.object({ error: z.string() }) } },
      description: "Provider not configured",
    },
    404: {
      content: { "application/json": { schema: z.object({ error: z.string() }) } },
      description: "Provider not found",
    },
    502: {
      content: {
        "application/json": {
          schema: z.object({ error: z.string(), durationMs: z.number() }),
        },
      },
      description: "Provider call failed",
    },
  },
})

export interface ProviderTestChatDeps {
  registry: ProviderRegistry
}

export function providerTestChatHandler(deps: ProviderTestChatDeps) {
  return async (c: Context) => {
    const id = c.req.param("id") ?? ""
    if (!id) {
      return c.json({ error: "Provider not found" }, 404)
    }
    const { prompt, model } = c.req.valid("json" as never) as {
      prompt: string
      model?: string
    }
    const provider = deps.registry.get(id)
    if (!provider) {
      return c.json({ error: "Provider not found" }, 404)
    }
    if (!provider.isConfigured()) {
      return c.json({ error: "Provider not configured (missing API key)" }, 400)
    }
    const effectiveModel = model ?? deps.registry.getEffectiveDefaultModel(id)
    const startedAt = Date.now()
    try {
      const res = await provider.chat([{ role: "user", content: prompt }], {
        model: effectiveModel,
      })
      return c.json({
        ok: true as const,
        providerId: id,
        model: res.model || effectiveModel,
        content: res.content,
        durationMs: Date.now() - startedAt,
        ...(res.usage
          ? {
              usage: {
                promptTokens: res.usage.promptTokens,
                completionTokens: res.usage.completionTokens,
                totalTokens: res.usage.totalTokens,
              },
            }
          : {}),
      })
    } catch (err) {
      return c.json(
        {
          error: err instanceof Error ? err.message : "provider call failed",
          durationMs: Date.now() - startedAt,
        },
        502,
      )
    }
  }
}

export const sessionStoreStatusRoute = createRoute({
  method: "get",
  path: "/system/session-store",
  tags: ["system"],
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            available: z.boolean(),
            schemaVersion: z.number().int().nonnegative().nullable(),
            path: z.string().nullable(),
            /** Row counts per table; null = count unknown (unreadable). */
            tables: z.record(z.string(), z.number().int().nonnegative().nullable()),
          }),
        },
      },
      description: "Session side-store status (read-only, counts only)",
    },
  },
})

export interface SessionStoreStatusDeps {
  /** The live SessionStore, or undefined when the side store is disabled. */
  store?: unknown
}

/** Tables reported by GET /system/session-store. Fixed allowlist — the
 *  interpolated SQL in countSessionStoreRows cannot see request input. */
const SESSION_STORE_TABLES = ["sessions", "messages", "events", "usage", "steering_queue"] as const

/**
 * Row count via the store's SQLite handle. SessionStore has no public
 * counts API yet, so this reads the (private) `db` handle structurally;
 * when the handle is unreachable or the table is missing it returns null
 * and the route reports the count as unknown rather than guessing.
 */
function countSessionStoreRows(store: unknown, table: string): number | null {
  try {
    const db = (store as { db?: { prepare?: unknown } }).db
    if (!db || typeof db.prepare !== "function") return null
    const prepare = db.prepare as (sql: string) => { get(): unknown }
    const row = prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n?: unknown } | undefined
    return typeof row?.n === "number" ? row.n : null
  } catch {
    return null
  }
}

export function sessionStoreStatusHandler(deps: SessionStoreStatusDeps) {
  return async (c: Context) => {
    const store = deps.store as { schemaVersion?: unknown; path?: unknown } | undefined
    if (!store || typeof store.schemaVersion !== "number") {
      return c.json({ available: false, schemaVersion: null, path: null, tables: {} })
    }
    const tables: Record<string, number | null> = {}
    for (const table of SESSION_STORE_TABLES) {
      tables[table] = countSessionStoreRows(deps.store, table)
    }
    const schemaVersion = store.schemaVersion > 0 ? store.schemaVersion : null
    const storePath = typeof store.path === "string" ? store.path : null
    return c.json({ available: true, schemaVersion, path: storePath, tables })
  }
}
