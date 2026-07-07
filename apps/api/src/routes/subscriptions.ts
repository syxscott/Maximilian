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
  lastDeliveredAt?: string
  totalDeliveries: number
  totalFailures: number
}

interface SseClient {
  id: string
  send: (data: string) => void
  close: () => void
  events: string[]
}

const subscriptions = new Map<string, Subscription>()
const sseClients = new Map<string, SseClient>()

export function listSubscriptions(): Subscription[] {
  return [...subscriptions.values()]
}

export function getSubscription(id: string): Subscription | undefined {
  return subscriptions.get(id)
}

export function createSubscription(input: {
  type: "webhook" | "sse"
  target: string
  events?: string[]
  createdBy?: string
}): Subscription {
  const sub: Subscription = {
    id: `sub_${randomUUID().slice(0, 8)}`,
    type: input.type,
    target: input.target,
    events: input.events ?? [],
    secret: randomUUID(),
    createdAt: new Date().toISOString(),
    createdBy: input.createdBy,
    totalDeliveries: 0,
    totalFailures: 0,
  }
  subscriptions.set(sub.id, sub)
  return sub
}

export function deleteSubscription(id: string): boolean {
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
 */
export async function publishEvent(eventName: string, payload: unknown): Promise<void> {
  // Webhooks
  for (const sub of subscriptions.values()) {
    if (sub.type !== "webhook") continue
    if (sub.events.length > 0 && !sub.events.includes(eventName)) continue

    const body = JSON.stringify({ event: eventName, payload, deliveredAt: new Date().toISOString() })
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
        // 10-second timeout — webhooks must be fast.
        signal: AbortSignal.timeout(10_000),
      })
      sub.lastDeliveredAt = new Date().toISOString()
      sub.totalDeliveries++
      if (!res.ok) sub.totalFailures++
    } catch (err) {
      sub.totalFailures++
      console.warn(`[subscription ${sub.id}] webhook delivery failed:`, (err as Error).message)
    }
  }

  // SSE
  for (const client of sseClients.values()) {
    if (client.events.length > 0 && !client.events.includes(eventName)) continue
    try {
      client.send(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`)
    } catch (err) {
      console.warn(`[sse ${client.id}] send failed:`, (err as Error).message)
    }
  }
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
  secret: z.string(),
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