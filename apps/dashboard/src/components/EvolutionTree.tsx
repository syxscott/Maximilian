import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useTimeline } from "@/lib/api/hooks";
import { buildTimelineTree, type TimelineEntry } from "../api";
import { useLocale, t, formatDateTime } from "@max/i18n";

const MAX_DEPTH = 20;

const ACTION_COLORS: Record<string, string> = {
  birth: "bg-green-900/50 text-green-300 border-green-700",
  retire: "bg-red-900/50 text-red-300 border-red-700",
  promote: "bg-blue-900/50 text-blue-300 border-blue-700",
  demote: "bg-yellow-900/50 text-yellow-300 border-yellow-700",
  merge: "bg-purple-900/50 text-purple-300 border-purple-700",
  split: "bg-amber-900/50 text-amber-300 border-amber-700",
  rebalance_team: "bg-emerald-900/50 text-emerald-300 border-emerald-700",
};

const ACTION_BORDER_COLORS: Record<string, string> = {
  birth: "border-l-green-600",
  retire: "border-l-red-600",
  promote: "border-l-blue-600",
  demote: "border-l-yellow-600",
  merge: "border-l-purple-600",
  split: "border-l-amber-600",
  rebalance_team: "border-l-emerald-600",
};

export function EvolutionTree() {
  useLocale();
  const { data, isLoading, error } = useTimeline();
  // Backend returns a flat list of events; buildTimelineTree groups them by
  // subject (and honors parentId when present) so the UI can render a
  // parent → children tree (e.g. birth → promote → retire).
  const timeline = useMemo<TimelineEntry[]>(
    () => buildTimelineTree(data?.timeline ?? []),
    [data?.timeline],
  );

  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-xs font-medium text-muted-foreground mb-4 uppercase tracking-wider">
        {t("evolution.title")} ({t("evolution.subjects", { count: timeline.length })})
      </h2>

      {isLoading ? (
        <div className="text-center py-16 text-muted-foreground text-sm">{t("evolution.loading")}</div>
      ) : error ? (
        <div className="text-center py-16 text-sm text-destructive">{t("evolution.failedToLoad")}</div>
      ) : timeline.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          <p className="text-base font-medium mb-1 text-foreground">{t("evolution.empty.title")}</p>
          <p>{t("evolution.empty.hint")}</p>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        {timeline.map((entry) => (
          <TimelineNode key={entry.id} entry={entry} depth={0} />
        ))}
      </div>
    </div>
  );
}

function TimelineNode({ entry, depth }: { entry: TimelineEntry; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const children = entry.children ?? [];
  const hasChildren = children.length > 0;
  // Backend may omit utility; treat missing as neutral (0).
  const utility = entry.utility ?? 0;

  const borderColorClass = entry.approved ? "border-l-green-600" : "border-l-red-600";
  const actionColorClass = ACTION_COLORS[entry.action] ?? "bg-gray-800 text-gray-300";
  const utilityColorClass = utility > 0
    ? "text-green-400"
    : utility < 0
      ? "text-red-400"
      : "text-muted-foreground";

  if (depth >= MAX_DEPTH) {
    return (
      <div style={{ marginLeft: depth * 24 }} className="text-muted-foreground text-sm pl-4 py-1">
        {t("evolution.nested", { count: children.length })}
      </div>
    );
  }

  return (
    <div style={{ marginLeft: depth * 24 }}>
      <div className={`pl-4 border-l-2 ${borderColorClass}`}>
        <Card className={`bg-muted/30 ${ACTION_BORDER_COLORS[entry.action] ?? "border-border/50"} border-l-0`}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {hasChildren && (
                  <Collapsible open={expanded} onOpenChange={setExpanded}>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="icon" className="w-5 h-5 p-0 min-w-0">
                        {expanded ? "−" : "+"}
                      </Button>
                    </CollapsibleTrigger>
                  </Collapsible>
                )}
                {!hasChildren && <span className="w-5" />}
                <Badge className={actionColorClass}>{entry.action}</Badge>
                <span className="font-medium text-foreground">{entry.subject}</span>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant={entry.approved ? "default" : "destructive"}>
                  {entry.approved ? t("evolution.approved") : t("evolution.rejected")}
                </Badge>
                <span className="text-xs font-mono text-muted-foreground">
                  {entry.rolloutStatus}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span>
                {t("evolution.utility")}: <span className={utilityColorClass}>{utility.toFixed(2)}</span>
              </span>
              <span>{formatDateTime(entry.recordedAt)}</span>
              <span className="font-mono">{entry.proposalId.slice(0, 12)}</span>
            </div>
          </CardContent>
        </Card>

        {hasChildren && expanded && (
          <div className="mt-1 flex flex-col gap-1">
            {children.map((child) => (
              <TimelineNode key={child.id} entry={child} depth={depth + 1} />
            ))}
          </div>
        )}

        {hasChildren && !expanded && (
          <button
            onClick={() => setExpanded(true)}
            className="mt-1 ml-6 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
          >
            {t("evolution.more", { count: children.length })}
          </button>
        )}
      </div>
    </div>
  );
}
