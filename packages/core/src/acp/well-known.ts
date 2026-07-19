/**
 * /.well-known/agent-card HTTP middleware (borrowed from mcp-server).
 *
 * mcp-server/src/agent_card.py:36-61 implements an ASGI middleware that
 * intercepts GET /.well-known/agent.json and returns a static Agent Card.
 * The A2A spec uses `agent-card` (not `agent.json`) — see
 * kourai-khryseai/agents_manifest.py:14.
 *
 * Maximilian's adaptation: a framework-agnostic handler that returns
 * (status, headers, body) for any incoming HTTP-style request. The caller
 * (Hono / Express / native http) is responsible for serialising `body`
 * to the wire and writing headers.
 *
 * Usage (Hono):
 *   import { wellKnownMiddleware } from "@max/core/acp/well-known";
 *   app.get("/.well-known/agent-card", (c) => {
 *     const result = wellKnownMiddleware(c.req.path, registry);
 *     return c.json(result.body, result.status as 200 | 404);
 *   });
 */

import type { AgentRegistry } from "../orchestration/agent-registry.js";
import { buildAgentIndex, fallbackCardFor, validateAgentCard } from "./agent-card.js";

/** Response shape the caller writes to the wire. */
export interface WellKnownResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

/** Path constants for the A2A spec convention. */
export const WELL_KNOWN_PATHS = {
  /** Per-agent card (single). */
  AGENT_CARD: "/.well-known/agent-card",
  /** Whole-registry card index. */
  AGENT_CARD_INDEX: "/.well-known/agent-cards.json",
} as const;

/**
 * Build a static handler. Call the returned function from any HTTP framework
 * by passing the request path. Returns a 200 with the card index, a 200
 * with the per-agent card (when the path has a trailing agent id), or 404.
 */
export function wellKnownMiddleware(
  reqPath: string,
  registry: AgentRegistry,
): WellKnownResponse {
  const jsonHeaders: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=30",
  };

  if (reqPath === WELL_KNOWN_PATHS.AGENT_CARD_INDEX) {
    const index = buildAgentIndex(registry);
    return {
      status: 200,
      headers: jsonHeaders,
      body: { cards: index.cards, generatedAt: new Date().toISOString() },
    };
  }

  if (reqPath === WELL_KNOWN_PATHS.AGENT_CARD) {
    // Bare card endpoint: return the *index* (kourai pattern: a list of
    // all known agents). Many real deployments also serve a per-id card
    // at /agents/:id/agent-card; the helper below handles that.
    const index = buildAgentIndex(registry);
    return {
      status: 200,
      headers: jsonHeaders,
      body: { cards: index.cards, generatedAt: new Date().toISOString() },
    };
  }

  // Per-agent card path: /agents/:id/agent-card or /.well-known/agents/:id.json
  // We accept both conventions used in the wild:
  //   /.well-known/agent-card/<id>
  //   /.well-known/agents/<id>.json
  let id: string | null = null;
  const withSuffix = reqPath.startsWith(`${WELL_KNOWN_PATHS.AGENT_CARD}/`);
  if (withSuffix) {
    id = decodeURIComponent(reqPath.slice(WELL_KNOWN_PATHS.AGENT_CARD.length + 1));
  } else if (reqPath.startsWith("/.well-known/agents/") && reqPath.endsWith(".json")) {
    id = decodeURIComponent(reqPath.slice("/.well-known/agents/".length, -".json".length));
  }
  if (id) {
    const card = fallbackCardFor(registry, id);
    if (card) {
      const v = validateAgentCard(card);
      return {
        status: 200,
        headers: {
          ...jsonHeaders,
          "x-a2a-card-valid": v.ok ? "true" : "false",
          ...(v.ok ? {} : { "x-a2a-card-errors": v.errors.join("; ") }),
        },
        body: card,
      };
    }
    return {
      status: 404,
      headers: jsonHeaders,
      body: { error: "agent-not-found", id },
    };
  }

  return {
    status: 404,
    headers: jsonHeaders,
    body: { error: "not-found", path: reqPath },
  };
}
