/**
 * 6.5 — AgentBirthEngine
 *
 * Input: CapabilityProposal (or promoted CapabilityRecord)
 * Output: AgentBlueprint + recordUsage(1) on registry
 *
 * Persists to:
 *   <rootDir>/blueprints/<blueprintId>.json (delegates to BlueprintStore if provided)
 *   <rootDir>/agent-births/<birthId>.json (audit)
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  AgentBirthResultSchema,
  type AgentBirthResult,
  type CapabilityRecord,
  type CapabilityProposal,
} from "./types.js";
import type { AgentBlueprint } from "@max/dags";

export interface BirthDeps {
  rootDir: string;
  saveBlueprint?: (blueprint: AgentBlueprint) => Promise<void>;
}

export class AgentBirthEngine {
  constructor(private deps: BirthDeps) {}

  private dir(): string {
    return path.join(this.deps.rootDir, "agent-births");
  }

  async birth(
    proposalOrCapability: CapabilityProposal | CapabilityRecord
  ): Promise<AgentBirthResult> {
    const id =
      "capabilityId" in proposalOrCapability
        ? proposalOrCapability.capabilityId
        : proposalOrCapability.id;
    const displayName = proposalOrCapability.displayName;

    const role = this.deriveRole(id);
    const systemPrompt = this.composeSystemPrompt(role, displayName);

    const result: AgentBirthResult = AgentBirthResultSchema.parse({
      blueprintId: `bp-${role}-v1-${randomUUID().slice(0, 6)}`,
      role,
      displayName,
      systemPrompt,
      capabilities: [id],
      constraints: { outputFormat: "code" },
      version: "v1",
      parentCapability: id,
      createdAt: new Date().toISOString(),
    });

    if (this.deps.saveBlueprint) {
      const blueprint: AgentBlueprint = {
        id: result.blueprintId,
        role: result.role,
        displayName: result.displayName,
        goal: `Deliver ${result.displayName} work for parent capability ${result.parentCapability}`,
        systemPrompt: result.systemPrompt,
        capabilities: result.capabilities,
        tools: [],
        preferredModels: [],
        constraints: {
          outputFormat: result.constraints.outputFormat,
          maxTokens: result.constraints.maxTokens,
          temperature: result.constraints.temperature,
        },
        personality: {} as AgentBlueprint["personality"],
        voice: {} as AgentBlueprint["voice"],
        version: result.version,
        parentId: result.parentCapability,
        createdAt: result.createdAt,
        updatedAt: result.createdAt,
        stats: {
          totalTasks: 0,
          totalSuccesses: 0,
          avgScore: 0,
          avgExecutionTimeMs: 0,
        },
        metadata: { parentCapability: result.parentCapability },
      };
      await this.deps.saveBlueprint(blueprint);
    }
    await this.audit(result);
    return result;
  }

  private deriveRole(capabilityId: string): string {
    // Convert snake_case capability id to a snake_case role name.
    // mobile_app_development → mobile_app_development_agent
    return `${capabilityId}_agent`;
  }

  private composeSystemPrompt(role: string, displayName: string): string {
    return [
      `# ${displayName} Agent`,
      ``,
      `You are the ${displayName} (role: ${role}).`,
      `You specialize in this capability and follow its best practices.`,
      ``,
      `# Output discipline`,
      `- Produce concrete, working artifacts for your domain.`,
      `- State assumptions explicitly when contracts are missing.`,
      `- Prefer completeness over cleverness.`,
    ].join("\n");
  }

  private async audit(result: AgentBirthResult): Promise<void> {
    const validated = AgentBirthResultSchema.parse(result);
    await fs.mkdir(this.dir(), { recursive: true });
    await fs.writeFile(
      path.join(this.dir(), `${validated.blueprintId}.json`),
      JSON.stringify(validated, null, 2),
      "utf-8"
    );
  }
}
