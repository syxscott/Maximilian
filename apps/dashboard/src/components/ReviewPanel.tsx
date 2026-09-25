import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { useLocale, t, formatDateTime } from "@max/i18n"
import type { Workspace } from "../api"
import { OutputPanel } from "./OutputPanel"
import { QuoteBlock, TokenUsageBadge, tokenUsageModel } from "@/components/ai-elements"
import { resultUsage } from "./conversation/model"

// ── usage aggregate (model layer, exported for tests) ───────────────────────

export interface UsageAggregate {
  input: number
  output: number
  cacheRead: number
  total: number
}

/**
 * Sum the token usage carried by the workspace's task results — the
 * same payloads the timeline mounts TokenUsageBadge for, folded into
 * one header badge. A result contributes only when its usage payload
 * (resultUsage's documented shapes: `metadata.usage`, `usage`, self)
 * carries at least one finite token field; results without one are
 * skipped, and when NO result carries usage the aggregate is undefined
 * so the header renders no badge instead of a fabricated zero.
 */
export function aggregateResultUsage(
  results: ReadonlyArray<unknown> | undefined,
): UsageAggregate | undefined {
  if (!Array.isArray(results)) return undefined
  let known = false
  const out: UsageAggregate = { input: 0, output: 0, cacheRead: 0, total: 0 }
  for (const result of results) {
    const usage = resultUsage(result)
    if (usage === undefined) continue
    const model = tokenUsageModel(usage)
    if (!model.known) continue
    known = true
    out.input += model.input
    out.output += model.output
    out.cacheRead += model.cacheRead
    out.total += model.total
  }
  return known ? out : undefined
}

interface Props {
  workspace: Workspace | null
}

export function ReviewPanel({ workspace }: Props) {
  useLocale()
  const review = workspace?.review
  // The reviewed run's token usage, summed over the workspace's task
  // results (undefined → the header simply shows no badge).
  const usage = aggregateResultUsage(workspace?.results)

  if (!review) {
    if (workspace?.results.length) {
      return <OutputPanel workspace={workspace} />
    }
    return (
      <div className="p-4">
        <h2 className="text-lg font-semibold mb-2 text-foreground">{t("review.title")}</h2>
        <p className="text-muted-foreground text-sm">{t("review.empty")}</p>
      </div>
    )
  }

  const scoreColorClass =
    review.score >= 8
      ? "text-green-400 border-green-600"
      : review.score >= 5
        ? "text-yellow-400 border-yellow-600"
        : "text-red-400 border-red-600"

  return (
    <div className="flex flex-col h-full p-4">
      <h2 className="text-lg font-semibold mb-2 text-foreground">{t("review.title")}</h2>

      <div className="flex items-center gap-3 mb-3">
        <div
          className={`w-12 h-12 rounded-full border-2 flex items-center justify-center text-lg font-semibold bg-muted ${scoreColorClass}`}
        >
          {review.score}
        </div>
        <div>
          <div className="text-base font-medium text-foreground">{t("review.scoreLabel")}</div>
          <div className="text-xs text-muted-foreground">
            {t("review.reviewedAt", { time: formatDateTime(review.reviewedAt) })}
          </div>
        </div>
        {usage !== undefined && <TokenUsageBadge usage={usage} className="ml-auto" />}
      </div>

      <div className="mb-3">
        <h3 className="text-sm font-medium mb-1 text-foreground">{t("review.summary")}</h3>
        <p className="text-sm text-muted-foreground">{review.summary}</p>
      </div>

      {review.issues.length > 0 && (
        <div className="mb-3">
          <h3 className="text-sm font-medium mb-1 text-destructive">
            {t("review.issuesHeader", { count: review.issues.length })}
          </h3>
          <ul className="list-disc list-inside space-y-0.5">
            {review.issues.map((iss, i) => (
              <li key={i} className="text-sm text-destructive">
                {iss}
              </li>
            ))}
          </ul>
        </div>
      )}

      {review.suggestions.length > 0 && (
        <div className="mb-3">
          <h3 className="text-sm font-medium mb-1 text-blue-400">
            {t("review.suggestionsHeader", { count: review.suggestions.length })}
          </h3>
          {/* Suggestions as attributed quotes (ai-elements QuoteBlock).
              The review schema carries plain strings — no per-item
              source field — so QuoteBlock renders the text-only form
              and its attribution line stays out per its own contract. */}
          <div className="space-y-2" data-testid="review-suggestion-quotes">
            {review.suggestions.map((s, i) => (
              <QuoteBlock key={i} quote={s} />
            ))}
          </div>
        </div>
      )}

      <Collapsible className="mt-auto">
        <CollapsibleTrigger className="text-xs text-muted-foreground hover:text-foreground cursor-pointer">
          {t("review.viewRaw")}
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <OutputPanel workspace={workspace} />
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
