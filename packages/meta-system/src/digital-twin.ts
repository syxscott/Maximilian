/**
 * Phase 8.2 — Digital Twin (OrganizationSnapshot).
 *
 * A read-only in-memory snapshot of the organization at a moment in time.
 * All mutation proposals are applied to a cloned twin, never to the live
 * state. The orchestrator then compares simulate(twin) vs simulate(live)
 * to decide whether to apply the change.
 *
 * Captures: capabilities, blueprints, team graphs, leaderboards.
 */

import { randomUUID } from "node:crypto";
import {
  OrganizationSnapshotSchema,
  type OrganizationSnapshot,
  type CapabilityRecord,
} from "./types.js";
import type { AgentBlueprint, TeamGraph } from "@max/dags";

export interface CaptureInput {
  capabilities: CapabilityRecord[];
  blueprints: AgentBlueprint[];
  graphs: TeamGraph[];
  leaderboards?: Record<string, unknown>;
}

export interface TwinProposal {
  /** What kind of change to apply to the twin. */
  kind:
    | "birth"
    | "retire"
    | "promote"
    | "demote"
    | "merge"
    | "split"
    | "rebalance_team";
  /** Subject of the change (capability id or blueprint id or role). */
  subject: string;
  /** Optional target (e.g. merge target role, split target role). */
  target?: string;
}

export class DigitalTwin {
  /** Capture a snapshot of the current organization state. */
  static capture(input: CaptureInput): OrganizationSnapshot {
    const raw = {
      id: `snap-${randomUUID().slice(0, 8)}`,
      capturedAt: new Date().toISOString(),
      capabilities: input.capabilities,
      blueprints: input.blueprints as unknown as Record<string, unknown>[],
      graphs: input.graphs as unknown as Record<string, unknown>[],
      leaderboards: input.leaderboards ?? {},
    };
    // Deep clone to prevent shared references between snapshot and live state.
    return OrganizationSnapshotSchema.parse(structuredClone(raw));
  }

  /**
   * Apply a proposal to a cloned twin. Returns a NEW snapshot.
   * The original snapshot is never mutated.
   */
  static apply(snap: OrganizationSnapshot, proposal: TwinProposal): OrganizationSnapshot {
    const cloned: OrganizationSnapshot = {
      ...snap,
      capabilities: snap.capabilities.map((c) => ({ ...c })),
      blueprints: snap.blueprints.map((b) => ({ ...b })),
      graphs: snap.graphs.map((g) => ({ ...g })),
      leaderboards: { ...snap.leaderboards },
    };

    switch (proposal.kind) {
      case "birth": {
        cloned.capabilities.push({
          id: proposal.subject,
          displayName: proposal.subject,
          description: "",
          status: "active",
          promotedAt: new Date().toISOString(),
          usageCount: 0,
          totalExecutions: 0,
          avgScore: 0,
          avgDurationMs: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        cloned.blueprints.push({
          id: `bp-${proposal.subject}-twin`,
          role: `${proposal.subject}_agent`,
        } as unknown as typeof cloned.blueprints[number]);
        break;
      }
      case "retire": {
        for (const c of cloned.capabilities) {
          if ((c.id === proposal.subject || c.id + "_agent" === proposal.subject) && c.status !== "retired") {
            c.status = "retired";
            c.retiredAt = new Date().toISOString();
            c.updatedAt = c.retiredAt;
          }
        }
        for (const b of cloned.blueprints) {
          const bb = b as unknown as { id?: string; role?: string; retiredAt?: string };
          if (bb.id === proposal.subject || bb.role === proposal.subject) {
            bb.retiredAt = new Date().toISOString();
          }
        }
        break;
      }
      case "promote": {
        for (const c of cloned.capabilities) {
          if (c.id === proposal.subject && c.status !== "retired") {
            c.status = "active";
            c.promotedAt = new Date().toISOString();
            c.updatedAt = c.promotedAt;
          }
        }
        break;
      }
      case "demote": {
        for (const c of cloned.capabilities) {
          if (c.id === proposal.subject && c.status !== "retired") {
            c.status = "deprecated";
            c.updatedAt = new Date().toISOString();
          }
        }
        break;
      }
      case "merge": {
        // Subject role gets retired; target role keeps going.
        for (const b of cloned.blueprints) {
          const bb = b as unknown as { id?: string; role?: string; retiredAt?: string };
          if (bb.role === proposal.subject) {
            bb.retiredAt = new Date().toISOString();
          }
        }
        break;
      }
      case "split": {
        // Source role retires; a new role appears (proposal.target).
        for (const b of cloned.blueprints) {
          const bb = b as unknown as { id?: string; role?: string; retiredAt?: string };
          if (bb.role === proposal.subject) {
            bb.retiredAt = new Date().toISOString();
          }
        }
        cloned.blueprints.push({
          id: `bp-${proposal.target}-twin`,
          role: proposal.target ?? `${proposal.subject}_planner`,
        } as unknown as typeof cloned.blueprints[number]);
        break;
      }
      case "rebalance_team": {
        // No structural change; tracked via hint metadata in real flow.
        break;
      }
    }
    return cloned;
  }
}

/**
 * Build a SimulationInput from an OrganizationSnapshot, using each
 * blueprint's role as the node and a default profile.
 */
export function snapshotToSimulationInput(
  snap: OrganizationSnapshot,
  orgName: string
): {
  orgName: string;
  graph: TeamGraph;
  profiles: Record<string, { costPerCall: number; latencyMs: number; qualityScore: number }>;
} {
  const nodes = snap.blueprints.map((b, i) => {
    const bb = b as unknown as {
      id?: string;
      role?: string;
      displayName?: string;
      retiredAt?: string;
    };
    return {
      kind: "agent" as const,
      id: bb.id ?? `n-${i}`,
      blueprintId: bb.id ?? `bp-${i}`,
      role: bb.role ?? "unknown",
      displayName: bb.displayName ?? bb.role ?? "unknown",
      dependsOn: [] as string[],
      ...(bb.retiredAt ? { retiredAt: bb.retiredAt } : {}),
    };
  }).filter((n) => {
    const orig = snap.blueprints.find(
      (b) => (b as unknown as { id?: string }).id === n.blueprintId
    );
    return !(orig as unknown as { retiredAt?: string } | undefined)?.retiredAt;
  });

  const profiles: Record<string, { costPerCall: number; latencyMs: number; qualityScore: number }> = {};
  for (const node of nodes) {
    profiles[node.role] = profiles[node.role] ?? {
      costPerCall: 1,
      latencyMs: 1000,
      qualityScore: 7,
    };
  }

  return {
    orgName,
    graph: {
      id: `g-${snap.id}`,
      userRequest: `twin:${snap.id}`,
      capabilities: snap.capabilities.filter((c) => c.status === "active").map((c) => c.id),
      nodes: nodes.map(({ retiredAt: _r, ...rest }) => rest),
      edges: [],
      layers: [],
      createdAt: snap.capturedAt,
      status: "draft",
    },
    profiles,
  };
}