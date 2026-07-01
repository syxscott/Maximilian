import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useLocale, t } from "@max/i18n";
import type { Workspace } from "../api";

interface Props {
  workspace: Workspace | null;
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  running: "outline",
  completed: "default",
  failed: "destructive",
};

const ROLE_COLORS: Record<string, string> = {
  frontend: "bg-blue-900/50 text-blue-300 border-blue-700",
  backend: "bg-green-900/50 text-green-300 border-green-700",
  review: "bg-yellow-900/50 text-yellow-300 border-yellow-700",
  general: "bg-gray-800/50 text-gray-300 border-gray-600",
};

export function TaskPanel({ workspace }: Props) {
  useLocale();
  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-2 text-foreground">{t("task.title")}</h2>
      {!workspace?.plan ? (
        <p className="text-muted-foreground text-sm">{t("task.empty")}</p>
      ) : (
        <>
          <p className="text-muted-foreground text-sm mb-2">{workspace.plan.rationale}</p>
          <div className="space-y-2">
            {workspace.plan.tasks.map((task) => (
              <Card key={task.id} className="bg-muted/30 border-border/50">
                <CardContent className="py-2 px-3">
                  <div className="flex gap-1.5">
                    <Badge className={ROLE_COLORS[task.agentRole] ?? ROLE_COLORS.general}>
                      {task.agentRole}
                    </Badge>
                    <Badge variant={STATUS_VARIANT[task.status] ?? "secondary"}>
                      {task.status}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-foreground">{task.description}</p>
                  {task.dependsOn.length > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("task.dependsOn")}: {task.dependsOn.join(", ")}
                    </p>
                  )}
                  {task.error && (
                    <p className="mt-1 text-sm text-destructive">
                      error: {task.error}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
