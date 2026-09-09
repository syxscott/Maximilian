import { useState, useMemo } from "react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useExecutions, useExecutionGraph } from "@/lib/api/hooks"
import { useLocale, t } from "@max/i18n"
import { VirtualList } from "./VirtualList"
import { layoutKahn } from "@/lib/graph-layout"
import type { ExecutionTrace, UIGraph } from "../api"

export function ExecutionCanvas() {
  useLocale()
  const [selected, setSelected] = useState<string | null>(null)
  const { data: execData, isLoading: listLoading, error: listError } = useExecutions()
  const { data: graph, isLoading: graphLoading, error: graphError } = useExecutionGraph(selected)

  const executions = execData?.executions ?? []

  return (
    <div className="flex gap-6 h-full">
      <aside className="w-72 shrink-0 flex flex-col">
        <h2 className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">
          {t("execution.subtitle", { count: executions.length })}
        </h2>
        {listLoading ? (
          <p className="text-muted-foreground text-sm">{t("execution.loading")}</p>
        ) : listError ? (
          <p className="text-sm text-destructive">{t("execution.failedToLoad")}</p>
        ) : executions.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("execution.empty")}</p>
        ) : (
          <VirtualList
            items={executions}
            itemHeight={96}
            height="calc(100vh - 12rem)"
            className="flex-1"
            getItemKey={(ex) => ex.id}
            renderRow={(ex) => {
              const isSelected = selected === ex.id
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
                    <span>
                      {ex.assignedTeamGraph?.nodes?.length ?? 0} {t("execution.agents")}
                    </span>
                    <span>
                      {ex.steps?.length ?? 0} {t("execution.steps")}
                    </span>
                  </div>
                </button>
              )
            }}
          />
        )}
      </aside>

      <section className="flex-1 min-h-0">
        {graph ? (
          <GraphCanvas graph={graph} />
        ) : graphError ? (
          <div className="h-full flex items-center justify-center text-sm text-destructive">
            {t("execution.graph.failedToLoad")}
          </div>
        ) : graphLoading ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
            {t("execution.graph.loading")}
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
            {t("execution.graph.selectPrompt")}
          </div>
        )}
      </section>
    </div>
  )
}

function GraphCanvas({ graph }: { graph: UIGraph }) {
  const { nodes, edges } = graph

  const NODE_W = 180
  const NODE_H = 72
  const GAP_X = 120
  const GAP_Y = 20
  const PAD = 40

  const { positions, totalW, totalH } = useMemo(() => {
    // Delegate to the pure-function layout (borrowed from voicetree's
    // graph-model — now unit-testable in apps/dashboard/src/lib/graph-layout.test.ts).
    const r = layoutKahn(
      nodes.map((n) => ({ id: n.id, width: NODE_W, height: NODE_H })),
      edges.map((e) => ({ source: e.source, target: e.target })),
      { gapX: GAP_X, gapY: GAP_Y, padding: PAD },
    );
    return { positions: r.positions, totalW: r.width, totalH: r.height };
  }, [nodes, edges])

  return (
    <div className="h-full overflow-auto rounded-lg bg-muted/30 border border-border">
      <svg
        width={totalW}
        height={totalH}
        className="min-w-full min-h-full"
        role="img"
        aria-label={t("execution.graph.ariaLabel")}
      >
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" className="fill-muted-foreground" />
          </marker>
        </defs>

        {edges.map((e) => {
          const from = positions.get(e.source)
          const to = positions.get(e.target)
          if (!from || !to) return null
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
          )
        })}

        {nodes.map((n) => {
          const pos = positions.get(n.id)
          if (!pos) return null
          return (
            <g key={n.id} transform={`translate(${pos.x}, ${pos.y})`}>
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={6}
                className="fill-card stroke-primary"
                strokeWidth={1.5}
              />
              <text
                x={NODE_W / 2}
                y={24}
                textAnchor="middle"
                className="fill-blue-400"
                fontSize={11}
                fontFamily="monospace"
              >
                {n.id}
              </text>
              <text
                x={NODE_W / 2}
                y={46}
                textAnchor="middle"
                className="fill-foreground"
                fontSize={13}
                fontWeight="600"
              >
                {n.label}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const variant = {
    running: "outline",
    completed: "default",
    failed: "destructive",
  }[status] as "outline" | "default" | "destructive" | undefined

  return (
    <Badge variant={variant ?? "secondary"} className="text-xs">
      {status}
    </Badge>
  )
}
