/**
 * Webhook / SSE event subscriptions.
 *
 * Allows customers to subscribe to Maximilian events without polling:
 *   - Webhooks: POST delivery to a customer-supplied URL with HMAC-SHA256
 *               signature in `X-Maximilian-Signature`.
 *   - SSE: long-lived `text/event-stream` connection. Useful for local dev
 *          and admin dashboards.
 *
 * Storage is in-memory (ProcessScopedBus is the source of truth). For
 * production durability, swap in a `SubscriptionStore` interface backed
 * by Postgres / Redis — the rest of the API is unchanged.
 */

import { createHmac, randomUUID } from "node:crypto"
import { createRoute } from "@hono/zod-openapi"
import { z } from "zod"

export interface Subscription {
  id: string
  type: "webhook" | "sse"
  target: string // URL for webhook, ignored for sse
  events: string[] // empty = all events
  secret: string
  createdAt: string
  createdBy?: string
  tenantId?: string
  lastDeliveredAt?: string
  totalDeliveries: number
  totalFailures: number
}

interface SseClient {
  id: string
  send: (data: string) => void
  close: () => void
  events: string[]
  tenantId?: string // auth context of the connecting client
}

const subscriptions = new Map<string, Subscription>()
const sseClients = new Map<string, SseClient>()

export function listSubscriptions(tenantId?: string): Subscription[] {
  const all = [...subscriptions.values()]
  if (!tenantId) return all
  return all.filter((s) => !s.tenantId || s.tenantId === tenantId)
}

export function getSubscription(id: string, tenantId?: string): Subscription | undefined {
  const sub = subscriptions.get(id)
  if (!sub) return undefined
  if (tenantId && sub.tenantId && sub.tenantId !== tenantId) return undefined
  return sub
}

export function createSubscription(input: {
  type: "webhook" | "sse"
  target: string
  events?: string[]
  createdBy?: string
  tenantId?: string
}): Subscription {
  const sub: Subscription = {
    id: `sub_${randomUUID().slice(0, 8)}`,
    type: input.type,
    target: input.target,
    events: input.events ?? [],
    secret: randomUUID(),
    createdAt: new Date().toISOString(),
    createdBy: input.createdBy,
    tenantId: input.tenantId,
    totalDeliveries: 0,
    totalFailures: 0,
  }
  subscriptions.set(sub.id, sub)
  return sub
}

export function deleteSubscription(id: string, tenantId?: string): boolean {
  const sub = subscriptions.get(id)
  if (!sub) return false
  if (tenantId && sub.tenantId && sub.tenantId !== tenantId) return false
  return subscriptions.delete(id)
}

export function registerSseClient(client: SseClient): void {
  sseClients.set(client.id, client)
}

export function unregisterSseClient(id: string): void {
  sseClients.delete(id)
}

/**
 * Publish an event to all subscribers whose filters match.
 * Called by ScopedBus handlers — see api/src/index.ts.
 * @param eventName - the runtime event type
 * @param payload - the event payload (contains workspaceId for tenant routing)
 * @param tenantId - tenant that originated this event (from workspace.metadata.tenantId)
 */
export async function publishEvent(
  eventName: string,
  payload: unknown,
  tenantId?: string,
): Promise<void> {
  // SSE first - synchronous send, no network I/O. Subscribers get events
  // immediately even when webhook deliveries are slow or timing out.
  for (const client of sseClients.values()) {
    // Filter by tenant: client with no tenantId (legacy/global) receives all;
    // client with tenantId only receives events from the same tenant.
    if (client.tenantId !== undefined && client.tenantId !== tenantId) continue
    if (client.events.length > 0 && !client.events.includes(eventName)) continue
    try {
      client.send(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`)
    } catch (err) {
      console.warn(`[sse ${client.id}] send failed:`, (err as Error).message)
    }
  }

  // Webhooks - deliver concurrently so one slow endpoint can't block the
  // others. Previously this was a serial for-await loop, which meant a
  // single 10s-timeout webhook delayed every subsequent webhook AND every
  // SSE subscriber (SSE was sent after the webhook loop finished).
  // Tenant filter: sub without tenantId (legacy) receives all; sub with
  // tenantId only receives events from the same tenant.
  const webhookSubs = [...subscriptions.values()].filter(
    (s) =>
      s.type === "webhook" &&
      (s.tenantId === undefined || s.tenantId === tenantId) &&
      (s.events.length === 0 || s.events.includes(eventName)),
  )
  await Promise.allSettled(
    webhookSubs.map(async (sub) => {
      const body = JSON.stringify({
        event: eventName,
        payload,
        deliveredAt: new Date().toISOString(),
      })
      const sig = createHmac("sha256", sub.secret).update(body).digest("hex")
      try {
        const res = await fetch(sub.target, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-maximilian-event": eventName,
            "x-maximilian-signature": `sha256=${sig}`,
          },
          body,
          signal: AbortSignal.timeout(10_000),
        })
        sub.lastDeliveredAt = new Date().toISOString()
        sub.totalDeliveries++
        if (!res.ok) sub.totalFailures++
      } catch (err) {
        sub.totalFailures++
        console.warn(`[subscription ${sub.id}] webhook delivery failed:`, (err as Error).message)
      }
    }),
  )
}

// ── OpenAPI routes ──────────────────────────────────────────────────────────

const CreateSubscriptionRequest = z.object({
  type: z.enum(["webhook", "sse"]),
  target: z.string().min(1),
  events: z.array(z.string()).optional(),
})

const SubscriptionResponse = z.object({
  id: z.string(),
  type: z.enum(["webhook", "sse"]),
  target: z.string(),
  events: z.array(z.string()),
  // Secret is only returned at creation time. List/get responses omit
  // it so tenant A can't read tenant B's webhook signing key - the
  // list filter lets callers see global (tenantId-less) subscriptions,
  // and without stripping the secret those would leak to every tenant.
  secret: z.string().optional(),
  createdAt: z.string(),
  lastDeliveredAt: z.string().optional(),
  totalDeliveries: z.number(),
  totalFailures: z.number(),
})

const ListResponse = z.object({ subscriptions: z.array(SubscriptionResponse) })

export const createSubscriptionRoute = createRoute({
  method: "post",
  path: "/subscriptions",
  tags: ["subscriptions"],
  request: { body: { content: { "application/json": { schema: CreateSubscriptionRequest } } } },
  responses: {
    201: {
      content: { "application/json": { schema: SubscriptionResponse } },
      description: "Subscription created",
    },
  },
})

export const listSubscriptionsRoute = createRoute({
  method: "get",
  path: "/subscriptions",
  tags: ["subscriptions"],
  responses: {
    200: { content: { "application/json": { schema: ListResponse } }, description: "List" },
  },
})

export const deleteSubscriptionRoute = createRoute({
  method: "delete",
  path: "/subscriptions/{id}",
  tags: ["subscriptions"],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: "Deleted" },
    404: { description: "Not found" },
  },
})

export const streamEventsRoute = createRoute({
  method: "get",
  path: "/events/stream",
  tags: ["subscriptions"],
  request: {
    query: z.object({
      events: z.string().optional(),
    }),
  },
  responses: {
    200: {
      content: { "text/event-stream": { schema: z.string() } },
      description: "SSE stream of events",
    },
  },
})
