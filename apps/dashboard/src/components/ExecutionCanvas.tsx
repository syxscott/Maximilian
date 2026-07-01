import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useExecutions, useExecutionGraph } from "@/lib/api/hooks";
import { VirtualList } from "./VirtualList";
import type { ExecutionTrace, UIGraph } from "../api";

export function ExecutionCanvas() {
  const [selected, setSelected] = useState<string | null>(null);
  const { data: execData, isLoading: listLoading, error: listError } = useExecutions();
  const { data: graph, isLoading: graphLoading, error: graphError } = useExecutionGraph(selected);

  const executions = execData?.executions ?? [];

  return (
    <div className="flex gap-6 h-full">
      <aside className="w-72 shrink-0 flex flex-col">
        <h2 className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">
          Executions ({executions.length})
        </h2>
        {listLoading ? (
          <p className="text-muted-foreground text-sm">Loading executions...</p>
        ) : listError ? (
          <p className="text-sm text-destructive">Failed to load executions.</p>
        ) : executions.length === 0 ? (
          <p className="text-muted-foreground text-sm">No executions recorded yet.</p>
        ) : (
          <VirtualList
            items={executions}
            itemHeight={96}
            height="calc(100vh - 12rem)"
            className="flex-1"
            renderRow={(ex) => {
              const isSelected = selected === ex.id;
              return (
                <button
                  onClick={() => setSelected(ex.id)}
                  className={`w-full text-left p-3 rounded-lg transition-colors border mb-2 ${
                    isSelected
                      ? "border-primary bg-primary/10"
                      : "border-border bg-muted/30 hover:bg-muted/50"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-mono text-muted-foreground">{ex.id}</span>
                    <StatusBadge status={ex.status} />
                  </div>
                  <p className="text-sm line-clamp-2 text-foreground">{ex.userPrompt}</p>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{ex.assignedTeamGraph?.nodes?.length ?? 0} agents</span>
                    <span>{ex.steps?.length ?? 0} steps</span>
                  </div>
                </button>
              );
            }}
          />
        )}
      </aside>

      <section className="flex-1 min-h-0">
        {graph ? (
          <GraphCanvas graph={graph} />
        ) : graphError ? (
          <div className="h-full flex items-center justify-center text-sm text-destructive">
            Failed to load graph.
          </div>
        ) : graphLoading ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
            Loading graph...
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
            Select an execution to view its agent graph.
          </div>
        )}
      </section>
    </div>
  );
}

function GraphCanvas({ graph }: { graph: UIGraph }) {
  const { nodes, edges } = graph;

  const NODE_W = 180;
  const NODE_H = 72;
  const GAP_X = 120;
  const GAP_Y = 20;
  const PAD = 40;

  const { positions, totalW, totalH } = useMemo(() => {
    const adj = new Map<string, string[]>();
    for (const n of nodes) adj.set(n.id, []);
    for (const e of edges) {
      const list = adj.get(e.source);
      if (list) list.push(e.target);
    }

    const inDegree = new Map(nodes.map((n) => [n.id, 0]));
    for (const e of edges) inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);

    const layers: string[][] = [];
    const visited = new Set<string>();
    let queue = nodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0).map((n) => n.id);

    while (queue.length > 0) {
      layers.push(queue);
      for (const id of queue) visited.add(id);
      const next: string[] = [];
      for (const id of queue) {
        for (const target of adj.get(id) ?? []) {
          const deg = (inDegree.get(target) ?? 1) - 1;
          inDegree.set(target, deg);
          if (deg === 0 && !visited.has(target)) next.push(target);
        }
      }
      queue = next;
    }
    const remaining = nodes.filter((n) => !visited.has(n.id)).map((n) => n.id);
    if (remaining.length > 0) layers.push(remaining);

    const pos = new Map<string, { x: number; y: number }>();
    let maxH = 0;
    for (let col = 0; col < layers.length; col++) {
      const layer = layers[col];
      for (let row = 0; row < layer.length; row++) {
        const x = PAD + col * (NODE_W + GAP_X);
        const y = PAD + row * (NODE_H + GAP_Y);
        pos.set(layer[row], { x, y });
        maxH = Math.max(maxH, y + NODE_H + PAD);
      }
    }

    const w = PAD + layers.length * NODE_W + Math.max(0, layers.length - 1) * GAP_X + PAD;
    const h = Math.max(maxH, 300);
    return { positions: pos, totalW: w, totalH: h };
  }, [nodes, edges]);

  return (
    <div className="h-full overflow-auto rounded-lg bg-muted/30 border border-border">
      <svg width={totalW} height={totalH} className="min-w-full min-h-full" role="img" aria-label="Agent execution graph">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className="fill-muted-foreground" />
          </marker>
        </defs>

        {edges.map((e) => {
          const from = positions.get(e.source);
          const to = positions.get(e.target);
          if (!from || !to) return null;
          return (
            <line
              key={e.id}
              x1={from.x + NODE_W}
              y1={from.y + NODE_H / 2}
              x2={to.x}
              y2={to.y + NODE_H / 2}
              className="stroke-border"
              strokeWidth={1.5}
              markerEnd="url(#arrow)"
            />
          );
        })}

        {nodes.map((n) => {
          const pos = positions.get(n.id);
          if (!pos) return null;
          return (
            <g key={n.id} transform={`translate(${pos.x}, ${pos.y})`}>
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={6}
                className="fill-card stroke-primary"
                strokeWidth={1.5}
              />
              <text x={NODE_W / 2} y={24} textAnchor="middle" className="fill-blue-400" fontSize={11} fontFamily="monospace">
                {n.id}
              </text>
              <text x={NODE_W / 2} y={46} textAnchor="middle" className="fill-foreground" fontSize={13} fontWeight="600">
                {n.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variant = {
    running: "outline",
    completed: "default",
    failed: "destructive",
  }[status] as "outline" | "default" | "destructive" | undefined;

  return (
    <Badge variant={variant ?? "secondary"} className="text-xs">
      {status}
    </Badge>
  );
}
