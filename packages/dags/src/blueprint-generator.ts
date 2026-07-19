/**
 * Stage 2 — Blueprint Generator.
 *
 * Given a list of capability IDs, materialize a list of AgentBlueprints.
 *
 * Generation rules:
 *   - Each capability becomes one blueprint.
 *   - Multiple capabilities that share a logical role are merged into one
 *     blueprint (e.g. "frontend" + "data_visualization" can both go into
 *     one frontend-style blueprint).
 *   - If the same role already has a blueprint on disk, the generator may
 *     either reuse it (default) or create a new version.
 */

import { randomUUID } from "node:crypto";
import type { AgentBlueprint, Capability, ModelHint } from "./types.js";
import { emptyStats, defaultPersonality, defaultVoice } from "./types.js";
import { CapabilityLibrary } from "./capability-library.js";
import { BlueprintStore, newBlueprintId } from "./blueprint-store.js";

export interface GeneratorOptions {
  /** Reuse existing blueprint for a role if present; do not create a new version. */
  reuseExisting?: boolean;
  /** Optional model hints to embed in the blueprint. */
  modelHints?: ModelHint[];
  /** User request (used to fill promptTemplate). */
  userRequest: string;
}

export class BlueprintGenerator {
  constructor(
    private library: CapabilityLibrary,
    private store: BlueprintStore
  ) {}

  async generate(
    capabilityIds: string[],
    options: GeneratorOptions
  ): Promise<AgentBlueprint[]> {
    const capabilities: Capability[] = [];
    for (const id of capabilityIds) {
      const c = this.library.get(id);
      if (c) capabilities.push(c);
    }

    // Group capabilities by logical role. The simplest grouping: one
    // capability = one role. If multiple capabilities share a category
    // (e.g. "frontend" + "data_visualization" → both frontend), they are
    // merged into one blueprint for that category.
    const grouped = groupByRole(capabilities);

    const out: AgentBlueprint[] = [];
    for (const { role, caps } of grouped) {
      if (options.reuseExisting) {
        const existing = await this.store.findByRole(role);
        if (existing[0]) {
          out.push(existing[0]);
          continue;
        }
      }
      const bp = synthesize(role, caps, options);
      await this.store.save(bp);
      out.push(bp);
    }
    return out;
  }
}

function groupByRole(capabilities: Capability[]): Array<{ role: string; caps: Capability[] }> {
  const groups = new Map<string, Capability[]>();
  for (const c of capabilities) {
    const role = mapCategoryToRole(c.category, c.id);
    const arr = groups.get(role) ?? [];
    arr.push(c);
    groups.set(role, arr);
  }
  return Array.from(groups.entries()).map(([role, caps]) => ({ role, caps }));
}

function mapCategoryToRole(category: string, fallback: string): string {
  switch (category) {
    case "product":   return "product_designer";
    case "frontend":  return "frontend";
    case "backend":   return "backend";
    case "data":      return "data_engineer";
    case "devops":    return "devops";
    case "testing":   return "tester";
    case "research":  return "researcher";
    case "writing":   return "writer";
    case "review":    return "reviewer";
    default:          return fallback;
  }
}

function synthesize(
  role: string,
  caps: Capability[],
  options: GeneratorOptions
): AgentBlueprint {
  const now = new Date().toISOString();
  const displayName = caps.map((c) => c.displayName).join(" + ");
  const goal = caps.map((c) => c.defaultGoal).join("; ");
  const systemPrompt = composePrompt(caps, options.userRequest);
  const tools = caps.flatMap((c) => c.defaultTools.map((name) => ({ name, description: name })));
  const constraints = caps.reduce<AgentBlueprint["constraints"]>(
    (acc, c) => mergeConstraints(acc, c.defaultConstraints),
    { outputFormat: "free" }
  );
  return {
    id: newBlueprintId(role),
    role,
    displayName,
    goal,
    systemPrompt,
    capabilities: caps.map((c) => c.id),
    tools,
    preferredModels: options.modelHints ?? [],
    constraints,
    personality: defaultPersonality(),
    voice: defaultVoice(),
    version: "v1",
    createdAt: now,
    updatedAt: now,
    stats: emptyStats(),
    metadata: { generatedFrom: caps.map((c) => c.id), request: options.userRequest.slice(0, 200) },
  };
}

function composePrompt(caps: Capability[], userRequest: string): string {
  const sections: string[] = [];
  sections.push(`You are operating in role(s): ${caps.map((c) => c.displayName).join(", ")}.`);
  sections.push("");
  for (const c of caps) {
    sections.push(`# ${c.displayName}`);
    sections.push(c.promptTemplate.replace(/\{\{userRequest\}\}/g, userRequest));
    sections.push("");
  }
  sections.push(`# Original user request`);
  sections.push(userRequest);
  return sections.join("\n");
}

function mergeConstraints(a: AgentBlueprint["constraints"], b: Capability["defaultConstraints"]): AgentBlueprint["constraints"] {
  return {
    outputFormat: b.outputFormat !== "free" ? b.outputFormat : a.outputFormat,
    maxTokens: b.maxTokens ?? a.maxTokens,
    temperature: b.temperature ?? a.temperature,
    mustIncludeCodeBlocks: b.mustIncludeCodeBlocks ?? a.mustIncludeCodeBlocks,
  };
}
