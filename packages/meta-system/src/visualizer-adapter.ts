/**
 * Phase 11 — VisualizerAdapter.
 *
 * Pure-transformation service that converts raw telemetry data into
 * UI-ready graph and timeline structures (compatible with React Flow / G6).
 * No filesystem access, no side effects — synchronous data reshaping only.
 */

import { z } from "zod";

// ── UI Graph Types ──────────────────────────────────────────────────────────

export const UINodeSchema = z.object({
  id: z.string(),
  type: z.enum(["agent", "capability", "review"]),
  label: z.string(),
  model: z.string().optional(),
});
export type UINode = z.infer<typeof UINodeSchema>;

export const UIEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  type: z.enum(["dependency", "data_flow", "review"]),
});
export type UIEdge = z.infer<typeof UIEdgeSchema>;

export const UIGraphSchema = z.object({
  nodes: z.array(UINodeSchema),
  edges: z.array(UIEdgeSchema),
});
export type UIGraph = z.infer<typeof UIGraphSchema>;

// ── Timeline Types ──────────────────────────────────────────────────────────

export const TimelineEntrySchema: z.ZodType<TimelineEntry> = z.object({
  id: z.string(),
  proposalId: z.string(),
  action: z.string(),
  subject: z.string(),
  approved: z.boolean(),
  utility: z.number(),
  recordedAt: z.string(),
  rolloutStatus: z.string(),
  children: z.array(z.lazy(() => TimelineEntrySchema)),
});
export interface TimelineEntry {
  id: string;
  proposalId: string;
  action: string;
  subject: string;
  approved: boolean;
  utility: number;
  recordedAt: string;
  rolloutStatus: string;
  children: TimelineEntry[];
}

export const EvolutionTimelineSchema = z.object({
  timeline: z.array(TimelineEntrySchema),
});
export type EvolutionTimeline = z.infer<typeof EvolutionTimelineSchema>;

// ── Input types (lightweight, matching telemetry schemas) ────────────────────

interface ExecutionTraceInput {
  id: string;
  assignedTeamGraph: {
    id: string;
    nodes: Array<{ id: string; role: string; displayName: string; dependsOn: string[] }>;
    capabilities: string[];
  };
}

interface EvolutionTraceInput {
  id: string;
  proposalId: string;
  proposalType: string;
  subject: string;
  approved: boolean;
  recordedAt: string;
  rolloutStatus: string;
  simulatedScores: { utility: number };
}

// ── Adapter ─────────────────────────────────────────────────────────────────

export class VisualizerAdapter {
  constructor(
    private getExecutions: () => ExecutionTraceInput[],
    private getEvolutions: () => EvolutionTraceInput[]
  ) {}

  /**
   * Transform an ExecutionTrace's assigned team graph into a UI-ready
   * node/edge structure compatible with React Flow or G6.
   *
   * Returns undefined if the execution trace is not found.
   */
  getUIReadyGraph(executionTraceId: string): UIGraph | undefined {
    const traces = this.getExecutions();
    const trace = traces.find((t) => t.id === executionTraceId);
    if (!trace) return undefined;

    const graph = trace.assignedTeamGraph;

    const nodes: UINode[] = graph.nodes.map((n) => ({
      id: n.id,
      type: "agent" as const,
      label: n.displayName || n.role,
    }));

    const edges: UIEdge[] = [];
    for (const node of graph.nodes) {
      for (const depId of node.dependsOn) {
        edges.push({
          id: `e-${depId}-${node.id}`,
          source: depId,
          target: node.id,
          type: "dependency",
        });
      }
    }

    return { nodes, edges };
  }

  /**
   * Aggregate EvolutionTraces into a hierarchical timeline tree,
   * grouped by subject and sorted by recordedAt.
   */
  getEvolutionTimeline(): EvolutionTimeline {
    const evolutions = this.getEvolutions();

    // Group by subject.
    const bySubject = new Map<string, EvolutionTraceInput[]>();
    for (const e of evolutions) {
      const arr = bySubject.get(e.subject) ?? [];
      arr.push(e);
      bySubject.set(e.subject, arr);
    }

    const timeline: TimelineEntry[] = [];

    for (const [subject, traces] of bySubject) {
      // Sort by recordedAt ascending.
      traces.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));

      // First trace for this subject is the root; rest are children.
      const [root, ...rest] = traces;
      if (!root) continue;

      const entry: TimelineEntry = {
        id: root.id,
        proposalId: root.proposalId,
        action: root.proposalType,
        subject,
        approved: root.approved,
        utility: root.simulatedScores.utility,
        recordedAt: root.recordedAt,
        rolloutStatus: root.rolloutStatus,
        children: rest.map((r) => ({
          id: r.id,
          proposalId: r.proposalId,
          action: r.proposalType,
          subject,
          approved: r.approved,
          utility: r.simulatedScores.utility,
          recordedAt: r.recordedAt,
          rolloutStatus: r.rolloutStatus,
          children: [],
        })),
      };

      timeline.push(entry);
    }

    // Sort top-level timeline by earliest recordedAt in each group.
    timeline.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));

    return { timeline };
  }
}
