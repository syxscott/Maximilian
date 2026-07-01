import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useLocale, t } from "@max/i18n";
import type { Workspace } from "../api";

interface Props {
  workspace: Workspace | null;
}

export function OutputPanel({ workspace }: Props) {
  useLocale();
  // Filter the review agent's results out (those go in ReviewPanel) and
  // memoise so OutputPanel doesn't recompute the array on every parent
  // re-render (workspace.status / submitting changes shouldn't bust this).
  const results = useMemo(
    () => (workspace?.results ?? []).filter((r) => r.agentRole !== "review"),
    [workspace?.results],
  );

  if (results.length === 0) {
    return (
      <div className="p-4">
        <h2 className="text-lg font-semibold mb-2 text-foreground">{t("output.title")}</h2>
        <p className="text-muted-foreground text-sm">{t("output.empty")}</p>
      </div>
    );
  }

  // Stable, unique tab value: same agentRole can produce multiple results,
  // so id+index gives a unique value and key (avoids React duplicate-key
  // warnings and ensures each tab keeps its own state).
  const tabValue = (r: { id: string }, i: number) => `${r.id}::${i}`;

  return (
    <div className="flex flex-col h-full p-4">
      <h2 className="text-lg font-semibold mb-2 text-foreground">{t("output.title")}</h2>
      <Tabs defaultValue={tabValue(results[0]!, 0)} className="flex-1 flex flex-col">
        <TabsList className="flex-wrap">
          {results.map((r, i) => {
            const v = tabValue(r, i);
            return (
              <TabsTrigger key={v} value={v}>
                {r.agentRole} #{i + 1}
              </TabsTrigger>
            );
          })}
        </TabsList>
        {results.map((r, i) => {
          const v = tabValue(r, i);
          return (
            <TabsContent key={v} value={v} className="flex-1 overflow-auto mt-2">
              <div className="flex items-center justify-between mb-1">
                <Badge variant="outline" className="text-muted-foreground">
                  {r.agentRole} &rarr; {r.id.slice(0, 8)}
                </Badge>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => navigator.clipboard.writeText(r.output)}
                >
                  Copy
                </Button>
              </div>
              <pre className="text-sm whitespace-pre-wrap break-words rounded-md p-3 overflow-auto max-h-[60vh] bg-muted/50 border border-border text-foreground">
                {r.output}
              </pre>
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
