import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useLocale, t } from "@max/i18n";
import type { Workspace, RuntimeEvent } from "../api";

interface Props {
  workspace: Workspace | null;
  events: RuntimeEvent[];
}

function getTaskStatus(taskId: string, events: RuntimeEvent[]): string {
  const failed = events.some((e) => e.type === "task-failed" && (e as Record<string, unknown>).taskId === taskId);
  if (failed) return "failed";
  const done = events.some((e) => e.type === "task-complete" && (e as Record<string, unknown>).taskId === taskId);
  if (done) return "completed";
  const active = events.some((e) => e.type === "task-start" && (e as Record<string, unknown>).taskId === taskId);
  if (active) return "running";
  return "pending";
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  running: "outline",
  completed: "default",
  failed: "destructive",
};

const ROLE_COLORS: Record<string, string> = {
  commander: "bg-purple-900/50 text-purple-300 border-purple-700",
  frontend: "bg-blue-900/50 text-blue-300 border-blue-700",
  backend: "bg-green-900/50 text-green-300 border-green-700",
  review: "bg-yellow-900/50 text-yellow-300 border-yellow-700",
  general: "bg-gray-800/50 text-gray-300 border-gray-600",
};

export function AgentPanel({ workspace, events }: Props) {
  useLocale();
  const agentRows = useMemo(() => {
    if (!workspace?.plan) return [];
    return workspace.plan.tasks.map((task) => ({
      task,
      status: getTaskStatus(task.id, events),
    }));
  }, [workspace?.plan, events]);

  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-2 text-foreground">{t("agent.title")}</h2>
      {agentRows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("agent.empty")}</p>
      ) : (
        <div className="space-y-2">
          {agentRows.map(({ task, status }) => (
            <Card key={task.id} className="bg-muted/30 border-border/50">
              <CardContent className="py-2 px-3">
                <div className="flex gap-1.5">
                  <Badge className={ROLE_COLORS[task.agentRole] ?? ROLE_COLORS.general}>
                    {task.agentRole}
                  </Badge>
                  <Badge variant={STATUS_VARIANT[status] ?? "secondary"}>
                    {status}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-foreground">{task.description}</p>
                {task.id && (
                  <p className="mt-1 text-xs font-mono text-muted-foreground">id: {task.id}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
