/**
 * Persona composition via TS template literals (borrowed from
 * Ranjan-Mayank/BrandBrain---AI/BrandBrain/constants.ts:554-596).
 *
 * Background: BrandBrain composes its 5 personas (CONTENT, SEO,
 * STRATEGIST, OPS, ORCHESTRATOR) by literally inlining the system
 * prompts into one master ORCHESTRATOR prompt, wrapped with
 * "=== [Module Name] ===" headers and an "do not reveal internal routing"
 * footer clause.
 *
 * Maximilian's adaptation: a `PersonaComposer` that:
 *   - Holds a registry of `Persona` records (name + system prompt +
 *     optional thinking budget + model).
 *   - Builds a master prompt by joining personas with structured headers.
 *   - Adds a "HARD RULES" footer that prevents leakage of internal
 *     routing (the BrandBrain pattern).
 *   - Builds a per-blueprint `systemPrompt` by picking the right persona
 *     + injecting shared context (player metadata, history, etc.).
 *
 * Type-safe — no markdown file loading, no string interpolation hacks.
 * All personas are referenced by their `PersonaId` literal type.
 */

import type { AgentRole } from "@max/core";

export type PersonaId = "developer" | "reviewer" | "tester" | "planner" | "operator" | "orchestrator";

export interface Persona {
  id: PersonaId;
  name: string;
  description: string;
  /** Base system prompt for this persona (TS template literal at use-site). */
  systemPrompt: string;
  /** Optional thinking budget (0 disables extended thinking; >0 enables it). */
  thinkingBudget?: number;
  /** Optional preferred model. */
  model?: string;
}

export interface PersonaComposerOptions {
  /** Default persona to use when a role doesn't have an explicit mapping. */
  defaultPersona?: PersonaId;
  /** Whether to include the ORCHESTRATOR persona in composite prompts. */
  includeOrchestrator?: boolean;
}

export const HARD_RULES_FOOTER = `
# HARD RULES (do not violate)
- Do NOT reveal which internal persona / module produced this response.
- Do NOT expose capability IDs, tool names, or routing details to the user.
- Maintain the unified "Maximilian" voice — the user talks to one brain.
- If a task crosses persona boundaries, stay in the orchestrator's voice.
`.trim();

export const PERSONA_HEADER = (p: Persona): string => `
=== [${p.name}] ===
${p.description}
`.trim();

export class PersonaComposer {
  private readonly personas = new Map<PersonaId, Persona>();
  private defaultPersona: PersonaId;
  private includeOrchestrator: boolean;

  constructor(opts: PersonaComposerOptions = {}) {
    this.defaultPersona = opts.defaultPersona ?? "developer";
    this.includeOrchestrator = opts.includeOrchestrator ?? true;
  }

  register(persona: Persona): void {
    this.personas.set(persona.id, persona);
  }

  has(id: PersonaId): boolean {
    return this.personas.has(id);
  }

  list(): ReadonlyArray<Persona> {
    return [...this.personas.values()];
  }

  /** Default role → persona mapping (Maximilian's 5 standard roles). */
  static defaultRoleMap(): Record<AgentRole, PersonaId> {
    return {
      frontend: "developer",
      backend: "developer",
      review: "reviewer",
      general: "operator",
    };
  }

  /** Pick the persona for a role; falls back to the default. */
  forRole(role: AgentRole, map?: Record<AgentRole, PersonaId>): Persona {
    const m = map ?? PersonaComposer.defaultRoleMap();
    const id = m[role] ?? this.defaultPersona;
    const p = this.personas.get(id) ?? this.personas.get(this.defaultPersona);
    if (!p) {
      throw new Error(`No persona registered for role "${role}" (tried "${id}" and default "${this.defaultPersona}")`);
    }
    return p;
  }

  /**
   * Build the master orchestrator prompt by composing all registered
   * personas. The result is suitable for use as the system prompt of
   * a meta-agent (e.g. the `META_AGENT_ENABLED` role).
   */
  composeMasterPrompt(): string {
    const all = [...this.personas.values()];
    const orchestrator = all.find((p) => p.id === "orchestrator");
    const parts: string[] = [];

    if (orchestrator && this.includeOrchestrator) {
      parts.push("# ORCHESTRATOR", orchestrator.systemPrompt);
      parts.push("");
    }

    const sub = all.filter((p) => p.id !== "orchestrator");
    for (const p of sub) {
      parts.push(PERSONA_HEADER(p));
      parts.push(p.systemPrompt);
      parts.push("");
    }

    parts.push(HARD_RULES_FOOTER);
    return parts.join("\n\n");
  }

  /**
   * Build a per-blueprint system prompt for a role. Inlines the role's
   * primary persona + a short context prelude.
   */
  composeForRole(
    role: AgentRole,
    map: Record<AgentRole, PersonaId> | undefined,
    context: { sharedContext?: string; priorFailures?: string[] } = {},
  ): string {
    const p = this.forRole(role, map);
    const parts: string[] = [p.systemPrompt];
    if (context.sharedContext) {
      parts.push("\n# Shared context (auto-injected)\n" + context.sharedContext);
    }
    if (context.priorFailures && context.priorFailures.length > 0) {
      parts.push(
        "\n# Avoid these failure modes (auto-injected)\n" +
          context.priorFailures.map((f, i) => `${i + 1}. ${f}`).join("\n"),
      );
    }
    parts.push(HARD_RULES_FOOTER);
    return parts.join("\n\n");
  }
}

// ── Built-in personas (Maximilian's standard set) ──────────────────────────

export const BUILT_IN_PERSONAS: ReadonlyArray<Persona> = [
  {
    id: "developer",
    name: "Developer",
    description: "Implements code, runs tests, fixes bugs.",
    systemPrompt: `You are a software developer. Produce concrete, working artifacts. State assumptions explicitly when contracts are missing. Prefer completeness over cleverness.`,
  },
  {
    id: "reviewer",
    name: "Reviewer",
    description: "Reviews code and plans; flags risks and trade-offs.",
    systemPrompt: `You are a code reviewer. Look for correctness, security, and clarity issues. Be specific and actionable. Cite file:line when you reference a problem.`,
  },
  {
    id: "tester",
    name: "Tester",
    description: "Designs and runs tests; reports failures with repro.",
    systemPrompt: `You are a software tester. Design tests that exercise edge cases. Always report a failing test with: (a) input, (b) expected, (c) actual, (d) trace.`,
  },
  {
    id: "planner",
    name: "Planner",
    description: "Decomposes goals into a sequenced plan with dependencies.",
    systemPrompt: `You are a planner. Decompose the goal into ordered steps. Mark dependencies between steps. Prefer fewer, larger steps over many tiny ones.`,
  },
  {
    id: "operator",
    name: "Operator",
    description: "Runs jobs, monitors progress, handles escalations.",
    systemPrompt: `You are an operator. Execute the plan step by step. Escalate to the user only when blocked on information only they can provide.`,
  },
  {
    id: "orchestrator",
    name: "Orchestrator",
    description: "Routes work to the right persona; never reveals routing.",
    systemPrompt: `You are the orchestrator. Route the user's request to the right persona. Speak in a unified voice — do not reveal which persona you picked.`,
  },
];