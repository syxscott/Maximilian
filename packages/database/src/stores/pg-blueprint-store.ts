import { eq, and, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { blueprints, teamGraphs } from "../schema.js";

/**
 * PostgreSQL-backed blueprint store.
 * API-compatible with BlueprintStore from @max/dags.
 *
 * Stores both blueprints and team graphs in PostgreSQL
 * instead of JSON files.
 */
export class PgBlueprintStore {
  constructor(private db: PostgresJsDatabase) {}

  // ---- Blueprints -----------------------------------------------------------

  async save(blueprint: BlueprintRow): Promise<void> {
    await this.db
      .insert(blueprints)
      .values({
        id: blueprint.id,
        role: blueprint.role,
        displayName: blueprint.displayName,
        goal: blueprint.goal,
        systemPrompt: blueprint.systemPrompt,
        capabilities: blueprint.capabilities,
        tools: blueprint.tools,
        preferredModels: blueprint.preferredModels,
        constraints: blueprint.constraints,
        version: blueprint.version,
        parentId: blueprint.parentId ?? null,
        createdAt: blueprint.createdAt,
        updatedAt: blueprint.updatedAt,
        retiredAt: blueprint.retiredAt ?? null,
        stats: blueprint.stats,
        metadata: blueprint.metadata,
      })
      .onConflictDoUpdate({
        target: blueprints.id,
        set: {
          role: blueprint.role,
          displayName: blueprint.displayName,
          goal: blueprint.goal,
          systemPrompt: blueprint.systemPrompt,
          capabilities: blueprint.capabilities,
          tools: blueprint.tools,
          preferredModels: blueprint.preferredModels,
          constraints: blueprint.constraints,
          version: blueprint.version,
          parentId: blueprint.parentId ?? null,
          updatedAt: blueprint.updatedAt,
          retiredAt: blueprint.retiredAt ?? null,
          stats: blueprint.stats,
          metadata: blueprint.metadata,
        },
      });
  }

  async get(id: string): Promise<BlueprintRow | undefined> {
    const rows = await this.db
      .select()
      .from(blueprints)
      .where(eq(blueprints.id, id))
      .limit(1);
    if (rows.length === 0) return undefined;
    return rowToBlueprint(rows[0]);
  }

  async listAll(): Promise<BlueprintRow[]> {
    const rows = await this.db.select().from(blueprints);
    return rows.map(rowToBlueprint);
  }

  async findByRole(role: string): Promise<BlueprintRow[]> {
    const rows = await this.db
      .select()
      .from(blueprints)
      .where(and(eq(blueprints.role, role), isNull(blueprints.retiredAt)));
    return rows
      .map(rowToBlueprint)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async retire(id: string): Promise<void> {
    const existing = await this.get(id);
    if (!existing) return;
    await this.db
      .update(blueprints)
      .set({ retiredAt: new Date().toISOString() })
      .where(eq(blueprints.id, id));
  }

  // ---- Graphs ---------------------------------------------------------------

  async saveGraph(graph: TeamGraphRow): Promise<void> {
    await this.db
      .insert(teamGraphs)
      .values({
        id: graph.id,
        userRequest: graph.userRequest,
        capabilities: graph.capabilities,
        nodes: graph.nodes,
        edges: graph.edges,
        layers: graph.layers,
        createdAt: graph.createdAt,
        status: graph.status,
      })
      .onConflictDoUpdate({
        target: teamGraphs.id,
        set: {
          userRequest: graph.userRequest,
          capabilities: graph.capabilities,
          nodes: graph.nodes,
          edges: graph.edges,
          layers: graph.layers,
          status: graph.status,
        },
      });
  }

  async getGraph(id: string): Promise<TeamGraphRow | undefined> {
    const rows = await this.db
      .select()
      .from(teamGraphs)
      .where(eq(teamGraphs.id, id))
      .limit(1);
    if (rows.length === 0) return undefined;
    return rowToGraph(rows[0]);
  }

  async listGraphs(): Promise<TeamGraphRow[]> {
    const rows = await this.db.select().from(teamGraphs);
    return rows.map(rowToGraph);
  }
}

export interface BlueprintRow {
  id: string;
  role: string;
  displayName: string;
  goal: string;
  systemPrompt: string;
  capabilities: string[];
  tools: unknown[];
  preferredModels: unknown[];
  constraints: Record<string, unknown>;
  version: string;
  parentId?: string;
  createdAt: string;
  updatedAt: string;
  retiredAt?: string;
  stats: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface TeamGraphRow {
  id: string;
  userRequest: string;
  capabilities: string[];
  nodes: unknown[];
  edges: unknown[];
  layers: unknown[];
  createdAt: string;
  status: string;
}

function rowToBlueprint(row: typeof blueprints.$inferSelect): BlueprintRow {
  return {
    id: row.id,
    role: row.role,
    displayName: row.displayName,
    goal: row.goal,
    systemPrompt: row.systemPrompt,
    capabilities: (row.capabilities as string[]) ?? [],
    tools: (row.tools as unknown[]) ?? [],
    preferredModels: (row.preferredModels as unknown[]) ?? [],
    constraints: (row.constraints as Record<string, unknown>) ?? {},
    version: row.version,
    parentId: row.parentId ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    retiredAt: row.retiredAt ?? undefined,
    stats: (row.stats as Record<string, unknown>) ?? {},
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  };
}

function rowToGraph(row: typeof teamGraphs.$inferSelect): TeamGraphRow {
  return {
    id: row.id,
    userRequest: row.userRequest,
    capabilities: (row.capabilities as string[]) ?? [],
    nodes: (row.nodes as unknown[]) ?? [],
    edges: (row.edges as unknown[]) ?? [],
    layers: (row.layers as unknown[]) ?? [],
    createdAt: row.createdAt,
    status: row.status,
  };
}

// PgBlueprintStore: PostgreSQL-backed blueprint and team graph persistence.
// Replaces file-based BlueprintStore from @max/dags.
