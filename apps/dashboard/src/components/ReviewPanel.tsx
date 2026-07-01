import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useLocale, t, formatDateTime } from "@max/i18n";
import type { Workspace } from "../api";
import { OutputPanel } from "./OutputPanel";

interface Props {
  workspace: Workspace | null;
}

export function ReviewPanel({ workspace }: Props) {
  useLocale();
  const review = workspace?.review;

  if (!review) {
    if (workspace?.results.length) {
      return <OutputPanel workspace={workspace} />;
    }
    return (
      <div className="p-4">
        <h2 className="text-lg font-semibold mb-2 text-foreground">{t("review.title")}</h2>
        <p className="text-muted-foreground text-sm">{t("review.empty")}</p>
      </div>
    );
  }

  const scoreColorClass =
    review.score >= 8
      ? "text-green-400 border-green-600"
      : review.score >= 5
        ? "text-yellow-400 border-yellow-600"
        : "text-red-400 border-red-600";

  return (
    <div className="flex flex-col h-full p-4">
      <h2 className="text-lg font-semibold mb-2 text-foreground">{t("review.title")}</h2>

      <div className="flex items-center gap-3 mb-3">
        <div className={`w-12 h-12 rounded-full border-2 flex items-center justify-center text-lg font-semibold bg-muted ${scoreColorClass}`}>
          {review.score}
        </div>
        <div>
          <div className="text-base font-medium text-foreground">{t("review.scoreLabel")}</div>
          <div className="text-xs text-muted-foreground">
            {t("review.reviewedAt", { time: formatDateTime(review.reviewedAt) })}
          </div>
        </div>
      </div>

      <div className="mb-3">
        <h3 className="text-sm font-medium mb-1 text-foreground">{t("review.summary")}</h3>
        <p className="text-sm text-muted-foreground">{review.summary}</p>
      </div>

      {review.issues.length > 0 && (
        <div className="mb-3">
          <h3 className="text-sm font-medium mb-1 text-destructive">
            Issues ({review.issues.length})
          </h3>
          <ul className="list-disc list-inside space-y-0.5">
            {review.issues.map((iss, i) => (
              <li key={i} className="text-sm text-destructive">{iss}</li>
            ))}
          </ul>
        </div>
      )}

      {review.suggestions.length > 0 && (
        <div className="mb-3">
          <h3 className="text-sm font-medium mb-1 text-blue-400">
            Suggestions ({review.suggestions.length})
          </h3>
          <ul className="list-disc list-inside space-y-0.5">
            {review.suggestions.map((s, i) => (
              <li key={i} className="text-sm text-blue-400">{s}</li>
            ))}
          </ul>
        </div>
      )}

      <Collapsible className="mt-auto">
        <CollapsibleTrigger className="text-xs text-muted-foreground hover:text-foreground cursor-pointer">
          View raw outputs
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <OutputPanel workspace={workspace} />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
