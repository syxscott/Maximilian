/**
 * A2A Agent Card auto-derivation (borrowed from mcp-server + kourai-khryseai).
 *
 * Background:
 *   - mcp-server/src/a2a_bridge.py:565-643 derives an A2A v0.3.0 Agent Card
 *     from the agent's internal tools (inputSchema → examples, name → tags).
 *   - kourai-khryseai/agents_manifest.py:19-40 provides a *fallback* card
 *     synthesised from a static manifest when the live HTTP fetch fails
 *     (cold-start safety).
 *   - awesome-a2a-hub's 38 production agents all conform to a 200-char
 *     description cap and 1-6 tag convention.
 *
 * Maximilian's adaptation:
 *   - The "internal tools" surface is `AgentRegistry.list()` + each agent's
 *     `metadata.capabilities` (already declared at register time).
 *   - We *always* return a valid card (fallback path) so callers never see
 *     a 404 on `agent/card` for an agent we know about in-process.
 *   - Card generation is a pure function over an AgentLike snapshot — easy
 *     to unit-test, no I/O, no side effects.
 */

import type { AgentLike, AgentRegistry } from "../orchestration/agent-registry.js";
import type {
  A2AAgentCard,
  A2AInputMode,
  A2AOutputMode,
  A2ASkill,
  A2AAuthScheme,
} from "./index.js";

/** Max description length per awesome-a2a-hub convention. */
export const A2A_DESCRIPTION_MAX = 200;
/** Max skill description length. */
export const A2A_SKILL_DESCRIPTION_MAX = 200;
/** Max skill id length. */
export const A2A_SKILL_ID_MAX = 64;
/** Tag count per skill. */
export const A2A_TAG_MIN = 1;
export const A2A_TAG_MAX = 6;

export interface CardDerivationOptions {
  /** Override the displayed agent name. */
  name?: string;
  /** Override the description. */
  description?: string;
  /** Override the supported transports (default: ["jsonrpc"]). */
  supportedTransports?: Array<"jsonrpc" | "grpc" | "http+sse">;
  /** Override the auth schemes (default: ["none"]). */
  authSchemes?: ReadonlyArray<A2AAuthScheme>;
  /** Override default input modes (default: ["text","data"]). */
  defaultInputModes?: ReadonlyArray<A2AInputMode>;
  /** Override default output modes (default: ["text","data"]). */
  defaultOutputModes?: ReadonlyArray<A2AOutputMode>;
  /** URL for HTTP deployments. */
  url?: string;
}

/** Validate a card against the A2A v0.3.0 length conventions. */
export function validateAgentCard(card: A2AAgentCard): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (card.protocolVersion !== "0.3.0") {
    errors.push(`protocolVersion must be "0.3.0", got "${card.protocolVersion}"`);
  }
  if (card.name.length === 0) {
    errors.push("name is required");
  }
  if (card.description.length > A2A_DESCRIPTION_MAX) {
    errors.push(`description exceeds ${A2A_DESCRIPTION_MAX} chars (got ${card.description.length})`);
  }
  if (card.skills.length === 0) {
    errors.push("at least one skill is required");
  }
  for (const skill of card.skills) {
    if (skill.id.length === 0 || skill.id.length > A2A_SKILL_ID_MAX) {
      errors.push(`skill.id must be 1-${A2A_SKILL_ID_MAX} chars, got "${skill.id}"`);
    }
    if (skill.description.length > A2A_SKILL_DESCRIPTION_MAX) {
      errors.push(
        `skill "${skill.id}" description exceeds ${A2A_SKILL_DESCRIPTION_MAX} chars ` +
          `(got ${skill.description.length})`,
      );
    }
    if (skill.tags.length < A2A_TAG_MIN || skill.tags.length > A2A_TAG_MAX) {
      errors.push(
        `skill "${skill.id}" tags must be ${A2A_TAG_MIN}-${A2A_TAG_MAX} entries, got ${skill.tags.length}`,
      );
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Derive a single agent's A2A v0.3.0 card from its AgentLike snapshot.
 *
 * The card is derived from `metadata.capabilities` if present, otherwise
 * falls back to deriving skills from the agent's `type` and `id` so a
 * valid card is always produced.
 */
export function deriveAgentCard(
  agent: AgentLike,
  opts: CardDerivationOptions = {},
): A2AAgentCard {
  const skills = extractSkills(agent);
  return {
    protocolVersion: "0.3.0",
    name: opts.name ?? deriveName(agent),
    description: opts.description ?? deriveDescription(agent),
    ...(opts.url !== undefined ? { url: opts.url } : {}),
    supportedInterfaces: [
      {
        protocolVersion: "0.3.0",
        transport: (opts.supportedTransports?.[0] ?? "jsonrpc") as
          | "jsonrpc"
          | "grpc"
          | "http+sse",
      },
      ...(opts.supportedTransports ?? [])
        .slice(1)
        .map((t) => ({ protocolVersion: "0.3.0" as const, transport: t })),
    ],
    authentication: {
      schemes: opts.authSchemes ?? (["none"] as ReadonlyArray<A2AAuthScheme>),
    },
    defaultInputModes: opts.defaultInputModes ?? (["text", "data"] as ReadonlyArray<A2AInputMode>),
    defaultOutputModes:
      opts.defaultOutputModes ?? (["text", "data"] as ReadonlyArray<A2AOutputMode>),
    skills,
  };
}

/**
 * Build a card for an agent by id, falling back to a synthetic card if the
 * agent isn't registered. This is the kourai-khryseai cold-start safety
 * pattern: never let `agent/card` return 404 for an in-process agent.
 */
export function fallbackCardFor(
  registry: AgentRegistry,
  agentId: string,
  opts: CardDerivationOptions = {},
): A2AAgentCard | null {
  const agent = registry.get(agentId);
  if (!agent) return null;
  return deriveAgentCard(agent, opts);
}

/** Build a system-wide agent card index, e.g. for the `/.well-known/agent-card` middleware. */
export function buildAgentIndex(registry: AgentRegistry): {
  agents: Array<{ id: string; type: string; status?: string }>;
  cards: A2AAgentCard[];
} {
  const agents = registry.list();
  return {
    agents: agents.map((a) => {
      const out: { id: string; type: string; status?: string } = { id: a.id, type: a.type }
      if (a.status !== undefined) out.status = a.status
      return out
    }),
    cards: agents.map((a) => deriveAgentCard(a)),
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────

function deriveName(agent: AgentLike): string {
  const explicit = readString(agent.metadata ?? {}, "name");
  if (explicit) return explicit;
  // Fall back to a Pascal-Case rendering of the type + id.
  return `${capitalize(agent.type)}:${agent.id}`;
}

function deriveDescription(agent: AgentLike): string {
  const explicit = readString(agent.metadata ?? {}, "description");
  if (explicit) return explicit.slice(0, A2A_DESCRIPTION_MAX);
  return `A Maximilian agent of type "${agent.type}" with id "${agent.id}".`.slice(
    0,
    A2A_DESCRIPTION_MAX,
  );
}

function extractSkills(agent: AgentLike): ReadonlyArray<A2ASkill> {
  const declared = agent.metadata?.capabilities;
  if (Array.isArray(declared) && declared.length > 0) {
    const out: A2ASkill[] = [];
    for (let i = 0; i < declared.length; i++) {
      const entry = declared[i];
      if (!entry || typeof entry !== "object") continue;
      const rec = entry as Record<string, unknown>;
      const id = readString(rec, "id") ?? `${agent.type}-skill-${i}`;
      const name = readString(rec, "name") ?? id;
      const description = (readString(rec, "description") ?? `${name} capability`).slice(
        0,
        A2A_SKILL_DESCRIPTION_MAX,
      );
      const tags = normalizeTags(rec.tags, name);
      const skill: A2ASkill = { id: id.slice(0, A2A_SKILL_ID_MAX), name, description, tags }
      const examples = readStringArray(rec.examples)
      if (examples !== undefined) skill.examples = examples
      const inputModes = readModeArray(rec.inputModes, agent)
      if (inputModes !== undefined) skill.inputModes = inputModes
      const outputModes = readModeArray(rec.outputModes, agent)
      if (outputModes !== undefined) skill.outputModes = outputModes
      out.push(skill)
    }
    if (out.length > 0) return out;
  }
  // Fallback: at least one skill derived from the agent type.
  return [
    {
      id: `${agent.type}-respond`.slice(0, A2A_SKILL_ID_MAX),
      name: `${agent.type}.respond`,
      description: `Receive and respond to messages of type "${agent.type}".`.slice(
        0,
        A2A_SKILL_DESCRIPTION_MAX,
      ),
      tags: [agent.type, "agent"],
    },
  ];
}

function normalizeTags(raw: unknown, fallbackName: string): ReadonlyArray<string> {
  if (Array.isArray(raw) && raw.length > 0) {
    const tags: string[] = [];
    for (const item of raw) {
      if (typeof item !== "string") continue;
      const trimmed = item.trim();
      if (!trimmed) continue;
      tags.push(trimmed);
      if (tags.length >= A2A_TAG_MAX) break;
    }
    if (tags.length >= A2A_TAG_MIN) return tags;
  }
  return [fallbackName, "agent"].slice(0, A2A_TAG_MAX);
}

function readString(rec: Record<string, unknown>, key: string): string | undefined {
  const v = rec[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function readStringArray(raw: unknown): ReadonlyArray<string> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    out.push(trimmed);
  }
  return out.length > 0 ? out : undefined;
}

function readModeArray(
  raw: unknown,
  _agent?: AgentLike,
): ReadonlyArray<A2AInputMode> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: A2AInputMode[] = [];
  for (const item of raw) {
    if (item === "text" || item === "data" || item === "file") {
      out.push(item);
    }
  }
  return out.length > 0 ? out : undefined;
}

function capitalize(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
