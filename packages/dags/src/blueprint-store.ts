/**
 * Blueprint persistence.
 *
 * Storage layout:
 *   <rootDir>/blueprints/<blueprintId>.json
 *   <rootDir>/graphs/<graphId>.json
 *
 * Append-only. Old versions remain on disk after retirement.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  AgentBlueprintSchema,
  TeamGraphSchema,
  type AgentBlueprint,
  type TeamGraph,
} from "./types.js";

export class BlueprintStore {
  constructor(private rootDir: string) {}

  private blueprintsDir(): string {
    return path.join(this.rootDir, "blueprints");
  }

  private graphsDir(): string {
    return path.join(this.rootDir, "graphs");
  }

  // ---- Blueprints ---------------------------------------------------------

  async save(blueprint: AgentBlueprint): Promise<void> {
    const validated = AgentBlueprintSchema.parse(blueprint);
    await fs.mkdir(this.blueprintsDir(), { recursive: true });
    const file = path.join(this.blueprintsDir(), `${validated.id}.json`);
    await fs.writeFile(file, JSON.stringify(validated, null, 2), "utf-8");
  }

  async get(id: string): Promise<AgentBlueprint | undefined> {
    try {
      const raw = await fs.readFile(path.join(this.blueprintsDir(), `${id}.json`), "utf-8");
      return AgentBlueprintSchema.parse(JSON.parse(raw));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw err;
    }
  }

  async listAll(): Promise<AgentBlueprint[]> {
    try {
      const entries = await fs.readdir(this.blueprintsDir());
      const out: AgentBlueprint[] = [];
      for (const name of entries) {
        if (!name.endsWith(".json")) continue;
        const raw = await fs.readFile(path.join(this.blueprintsDir(), name), "utf-8");
        out.push(AgentBlueprintSchema.parse(JSON.parse(raw)));
      }
      return out;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  async findByRole(role: string): Promise<AgentBlueprint[]> {
    const all = await this.listAll();
    return all
      .filter((b) => b.role === role && !b.retiredAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async retire(id: string): Promise<void> {
    const existing = await this.get(id);
    if (!existing) return;
    const retired = { ...existing, retiredAt: new Date().toISOString() };
    await this.save(retired);
  }

  // ---- Graphs -------------------------------------------------------------

  async saveGraph(graph: TeamGraph): Promise<void> {
    const validated = TeamGraphSchema.parse(graph);
    await fs.mkdir(this.graphsDir(), { recursive: true });
    const file = path.join(this.graphsDir(), `${validated.id}.json`);
    await fs.writeFile(file, JSON.stringify(validated, null, 2), "utf-8");
  }
}

export function newBlueprintId(role: string): string {
  return `bp-${role}-${randomUUID().slice(0, 8)}`;
}

export function newTeamId(): string {
  return `team-${randomUUID().slice(0, 8)}`;
}
