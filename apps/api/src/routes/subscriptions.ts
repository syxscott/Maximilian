/**
 * Webhook / SSE event subscriptions.
 *
 * Allows customers to subscribe to Maximilian events without polling:
 *   - Webhooks: POST delivery to a customer-supplied URL with HMAC-SHA256
 *               signature in `X-Maximilian-Signature`.
 *   - SSE: long-lived `text/event-stream` connection. Useful for local dev
 *          and admin dashboards.
 *
 * SSE delivery goes through the server-level EventFeed
 * (lib/event-feed.ts, opencode borrowing): every event is encoded into a
 * wire frame exactly ONCE and the same immutable string is offered to each
 * connection's bounded dropping queue — a lagging connection is killed on
 * overflow without touching the publisher or its peers.
 *
 * Storage is in-memory (ProcessScopedBus is the source of truth). For
 * production durability, swap in a `SubscriptionStore` interface backed
 * by Postgres / Redis — the rest of the API is unchanged.
 */

import { createHmac, randomUUID } from "node:crypto"
import { createRoute } from "@hono/zod-openapi"
import { z } from "zod"
import { EventFeed } from "../lib/event-feed.js"
import { isAllowedWebhookUrl, WebhookTargetRejectedError } from "../lib/webhook-target-guard.js"
import {
  DEFAULT_WEBHOOK_RESPONSE_MAX_BYTES,
  readResponseTextLimited,
  WebhookResponseTooLargeError,
} from "../lib/read-response-limited.js"

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

const subscriptions = new Map<string, Subscription>()

/**
 * Server-level SSE feed: single encoding point + per-connection bounded
 * queues. Route handlers register connections here (with a transport
 * `write` that respects stream backpressure); heartbeats and the connect
 * notice are written directly by the route and never consume queue budget.
 */
export const sseFeed = new EventFeed()

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

export interface CreateSubscriptionInput {
  type: "webhook" | "sse"
  target: string
  events?: string[]
  createdBy?: string
  tenantId?: string
  /**
   * Test/development escape hatch forwarded to `isAllowedWebhookUrl`
   * (gateway `allowInsecure` borrowing). Lets tests create a subscriber that
   * points at a local HTTP server; production callers leave it unset.
   */
  allowInsecureWebhookTargets?: boolean
}

export function createSubscription(input: CreateSubscriptionInput): Subscription {
  // SSRF guard (cc-switch usage_script.rs borrowing): the webhook target is
  // user-controlled egress. Reject loopback / private / link-local / cloud
  // metadata destinations before the subscription is stored, so a rejected
  // target can never enter the delivery map. The HTTP route additionally
  // validates via `CreateSubscriptionRequest`; this check covers direct
  // callers (tests, future internal consumers).
  if (input.type === "webhook") {
    const verdict = isAllowedWebhookUrl(input.target, {
      allowInsecure: input.allowInsecureWebhookTargets,
    })
    if (!verdict.ok) throw new WebhookTargetRejectedError(input.target, verdict.reason)
  }

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

export interface PublishEventOptions {
  /**
   * Webhook response byte cap (default 1 MiB, cc-switch
   * read_response_text_limited borrowing). Oversized responses abort and
   * count as a failed delivery; they are never treated as delivered.
   */
  maxResponseBytes?: number
  /**
   * Test/development escape hatch forwarded to `isAllowedWebhookUrl`
   * (gateway `allowInsecure` borrowing) for subscribers stored with an
   * insecure target (e.g. a test server on loopback).
   */
  allowInsecureWebhookTargets?: boolean
  /** Fetch implementation seam for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch
}

/**
 * Publish an event to all subscribers whose filters match.
 * Called by ScopedBus handlers — see api/src/index.ts.
 * @param eventName - the runtime event type
 * @param payload - the event payload (contains workspaceId for tenant routing)
 * @param tenantId - tenant that originated this event (from workspace.metadata.tenantId)
 * @param opts - delivery knobs (response cap, escape hatch, fetch seam)
 */
export async function publishEvent(
  eventName: string,
  payload: unknown,
  tenantId?: string,
  opts: PublishEventOptions = {},
): Promise<void> {
  const maxResponseBytes = opts.maxResponseBytes ?? DEFAULT_WEBHOOK_RESPONSE_MAX_BYTES
  const fetchImpl = opts.fetchImpl ?? fetch
  // SSE first — synchronous, encoded ONCE server-side (opencode event-feed
  // borrowing). Every subscriber connection receives the same immutable
  // frame string through its independent bounded queue; a lagging
  // connection is killed by its own overflow without touching the
  // publisher or peers. Webhook delivery below can therefore never be
  // blocked or re-encode for slow SSE clients.
  sseFeed.publish(eventName, payload, tenantId)

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

      // Re-check at delivery time too (defense in depth): a subscription may
      // predate the guard or have been stored with the insecure escape hatch.
      // This is the egress request an attacker controls, so it must pass the
      // same allowlist on every attempt.
      const verdict = isAllowedWebhookUrl(sub.target, {
        allowInsecure: opts.allowInsecureWebhookTargets,
      })
      if (!verdict.ok) {
        sub.totalFailures++
        console.warn(`[subscription ${sub.id}] webhook target rejected: ${verdict.reason}`)
        return
      }

      // Retry delivery up to 3 times with exponential backoff
      const maxRetries = 3
      let lastError: Error | undefined
      let attempts = 0
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        attempts++
        try {
          const res = await fetchImpl(sub.target, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-maximilian-event": eventName,
              "x-maximilian-signature": `sha256=${sig}`,
            },
            body,
            // No-follow (cc-switch usage_script.rs borrowing). In
            // Node/undici, `redirect: "manual"` resolves with the REAL 3xx
            // response (not an opaqueredirect), so the Location header and
            // body stay visible to this process while undici never connects
            // to the redirect target. That closes both the SSRF-via-302 path
            // (the target allowlist cannot be bypassed) and the leak of the
            // HMAC signature / POST body to a third-party host.
            redirect: "manual",
            signal: AbortSignal.timeout(10_000),
          })
          // Consume under a byte cap (and discard): a hostile endpoint must
          // not be able to OOM the API through its response body.
          await readResponseTextLimited(res, maxResponseBytes)
          sub.lastDeliveredAt = new Date().toISOString()
          sub.totalDeliveries++
          if (!res.ok) sub.totalFailures++
          return // Success, no need to retry
        } catch (err) {
          lastError = err as Error
          sub.totalFailures++
          // An oversized response will be oversized on every retry; fail
          // once instead of re-reading it three times.
          if (err instanceof WebhookResponseTooLargeError) break
          // Wait before retrying (exponential backoff: 1s, 2s, 4s)
          if (attempt < maxRetries - 1) {
            await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)))
          }
        }
      }
      console.warn(
        `[subscription ${sub.id}] webhook delivery failed after ${attempts} attempt(s):`,
        lastError?.message,
      )
    }),
  )
}

// ── OpenAPI routes ──────────────────────────────────────────────────────────

export const CreateSubscriptionRequest = z
  .object({
    type: z.enum(["webhook", "sse"]),
    target: z.string().min(1),
    events: z.array(z.string()).optional(),
  })
  // SSRF guard at the HTTP boundary as well: the OpenAPI validator rejects
  // a disallowed webhook target with 400 before the handler (or
  // createSubscription's own check) ever sees it. SSE targets are ignored by
  // delivery, so they are not validated.
  .superRefine((req, ctx) => {
    if (req.type !== "webhook") return
    const verdict = isAllowedWebhookUrl(req.target)
    if (!verdict.ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["target"],
        message: `webhook target rejected: ${verdict.reason}`,
      })
    }
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
