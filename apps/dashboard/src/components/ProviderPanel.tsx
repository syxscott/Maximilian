import { useEffect, useRef, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  useProviders,
  useSetDefaultProvider,
  useSetProviderModel,
  useProviderHealth,
  useCircuitBreakerStats,
  useResetCircuitBreaker,
  useAddToFailoverQueue,
  useRemoveFromFailoverQueue,
  useAutoFailoverEnabled,
} from "@/lib/api/hooks"
import { useLocale, t } from "@max/i18n"
import { VirtualList } from "./VirtualList"
import type { ProviderInfo, ProviderCategory } from "@/api"
import { Activity, AlertTriangle, CheckCircle, XCircle, Zap } from "lucide-react"

// ── Category config (borrowed from cc-switch) ─────────────────────────────

const CATEGORY_KEYS: Record<ProviderCategory, string> = {
  official: "provider.category.official",
  china: "provider.category.china",
  international: "provider.category.international",
  aggregator: "provider.category.aggregator",
  cloud: "provider.category.cloud",
  custom: "provider.category.custom",
}

const CATEGORY_COLORS: Record<ProviderCategory, string> = {
  official: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  china: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  international: "bg-green-500/10 text-green-500 border-green-500/20",
  aggregator: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  cloud: "bg-slate-500/10 text-slate-500 border-slate-500/20",
  custom: "bg-gray-500/10 text-gray-500 border-gray-500/20",
}

/**
 * Fallback model catalog for providers without modelVariants.
 * Mirrors cc-switch's hardcoded preset model lists.
 */
const PROVIDER_MODEL_CATALOG: Record<string, string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4-turbo", "o3-mini"],
  anthropic: [
    "claude-opus-4-7",
    "claude-sonnet-4-6",
    "claude-haiku-4-5-20251001",
    "claude-3-5-sonnet-latest",
    "claude-3-5-haiku-latest",
  ],
  openrouter: [
    "anthropic/claude-sonnet-4-6",
    "openai/gpt-4o",
    "google/gemini-2.5-pro",
    "meta-llama/llama-3.1-70b-instruct",
  ],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
}

/** Health status indicator dot — mirrors cc-switch's ProviderHealthBadge. */
function HealthDot({ status }: { status: string }) {
  if (status === "healthy") return <CheckCircle className="w-3.5 h-3.5 text-green-500" />
  if (status === "degraded") return <AlertTriangle className="w-3.5 h-3.5 text-yellow-500" />
  if (status === "down") return <XCircle className="w-3.5 h-3.5 text-red-500" />
  return <Activity className="w-3.5 h-3.5 text-muted-foreground" />
}

/** Circuit breaker state badge — mirrors cc-switch's FailoverPriorityBadge. */
function CircuitBreakerBadge({ state }: { state?: string }) {
  if (state === "closed") return null
  if (state === "open") return (
    <Badge variant="destructive" className="text-xs gap-1">
      <Zap className="w-3 h-3" />
      {t("provider.circuitBreaker")}
    </Badge>
  )
  if (state === "half-open") return (
    <Badge variant="secondary" className="text-xs gap-1">
      <Zap className="w-3 h-3" />
      {t("provider.probing")}
    </Badge>
  )
  return null
}

/** Failover priority badge — mirrors cc-switch's FailoverPriorityBadge. */
function FailoverPriorityBadge({ priority }: { priority?: number }) {
  if (!priority) return null
  return (
    <Badge variant="outline" className="text-xs">
      P{priority}
    </Badge>
  )
}

export function ProviderPanel() {
  useLocale()
  const { data: providerData, isLoading, error } = useProviders()
  const setDefault = useSetDefaultProvider()
  const setModel = useSetProviderModel()

  const providers = providerData?.providers ?? []
  const defaultId = providerData?.default

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <h2 className="text-lg font-semibold mb-4 text-foreground">{t("provider.title")}</h2>

      <Card className="bg-muted/20 mb-4">
        <CardContent className="py-3 px-4 text-xs text-muted-foreground">
          {t("provider.description")}
        </CardContent>
      </Card>

      {isLoading ? (
        <p className="text-muted-foreground text-sm">{t("provider.loading")}</p>
      ) : error ? (
        <p className="text-sm text-destructive">{t("provider.failedToLoad")}</p>
      ) : providers.length === 0 ? (
        <Card className="bg-muted/30">
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground text-sm">{t("provider.empty.title")}</p>
            <p className="text-xs text-muted-foreground mt-1">{t("provider.empty.hint")}</p>
          </CardContent>
        </Card>
      ) : (
        <VirtualList
          items={providers}
          itemHeight={172}
          height="60vh"
          className="rounded-md"
          getItemKey={(provider) => provider.id}
          renderRow={(provider) => (
            <div className="pb-3">
              <ProviderCard
                provider={provider}
                isDefault={provider.id === defaultId}
                onSetDefault={async () => {
                  await setDefault.mutateAsync({ providerId: provider.id })
                }}
                onSaveModel={async (model) => {
                  await setModel.mutateAsync({ providerId: provider.id, model })
                }}
                isMutating={
                  (setDefault.isPending && setDefault.variables?.providerId === provider.id) ||
                  (setModel.isPending && setModel.variables?.providerId === provider.id)
                }
              />
            </div>
          )}
        />
      )}
    </div>
  )
}

interface ProviderCardProps {
  provider: ProviderInfo
  isDefault: boolean
  onSetDefault: () => Promise<void>
  onSaveModel: (model: string) => Promise<void>
  isMutating: boolean
}

function ProviderCard({
  provider,
  isDefault,
  onSetDefault,
  onSaveModel,
  isMutating,
}: ProviderCardProps) {
  useLocale()

  // Health + circuit breaker polling (mirrors cc-switch's useProviderHealth / useCircuitBreakerStats)
  const { data: health } = useProviderHealth(provider.id)
  const { data: cbStats } = useCircuitBreakerStats(provider.id)
  const resetCircuit = useResetCircuitBreaker()
  const addToFailover = useAddToFailoverQueue()
  const removeFromFailover = useRemoveFromFailoverQueue()
  const { data: autoFailoverEnabled } = useAutoFailoverEnabled()

  // Model catalog: prefer provider.modelVariants, fall back to hardcoded catalog
  const modelVariants = provider.modelVariants
  const catalog = modelVariants?.map((v) => v.id) ?? PROVIDER_MODEL_CATALOG[provider.id]
  const [model, setModelState] = useState(provider.defaultModel)
  const [editing, setEditing] = useState(false)
  // Track the model the user has saved so the post-save "flash back" of
  // the OLD defaultModel during the refetch window doesn't overwrite the
  // newly-committed value. We compare against this ref instead of `model`
  // because `model` is the in-flight value the user is editing.
  const savedModelRef = useRef<string | null>(null)

  useEffect(() => {
    if (!editing && provider.defaultModel !== savedModelRef.current) {
      setModelState(provider.defaultModel)
    }
  }, [provider.defaultModel, editing])

  const handleBlur = () => setEditing(false)

  const healthStatus = health?.status ?? "unknown"
  const cbState = cbStats?.state

  return (
    <Card className={`bg-muted/30 ${isDefault ? "border-primary" : "border-border/50"}`}>
      <CardHeader className="py-3 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <CardTitle className="text-base text-foreground">{provider.name}</CardTitle>
            {isDefault && <Badge variant="default">{t("provider.default")}</Badge>}

            {/* Category badge — mirrors cc-switch's ProviderCard category display */}
            {provider.category && (
              <Badge className={CATEGORY_COLORS[provider.category]}>
                {t(CATEGORY_KEYS[provider.category])}
              </Badge>
            )}

            <Badge variant={provider.configured ? "outline" : "secondary"}>
              {provider.configured ? t("provider.configured") : t("provider.notConfigured")}
            </Badge>

            {/* Health status dot — mirrors cc-switch's HealthStatusIndicator */}
            <HealthDot status={healthStatus} />

            {/* Circuit breaker badge */}
            <CircuitBreakerBadge state={cbState} />

            {/* Failover priority badge */}
            <FailoverPriorityBadge priority={provider.failoverPriority} />

            {/* In-failover-queue indicator */}
            {provider.inFailoverQueue && (
              <Badge variant="outline" className="text-xs gap-1">
                <Zap className="w-3 h-3" />
                {t("provider.failoverBadge")}
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Health latency display */}
            {health?.latencyMs !== undefined && (
              <span className="text-xs text-muted-foreground">
                {health.latencyMs}ms
              </span>
            )}

            {!isDefault && (
              <Button
                size="sm"
                variant="outline"
                disabled={!provider.configured || isMutating}
                onClick={onSetDefault}
              >
                {t("provider.setDefault")}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="py-2 px-4 space-y-2">
        <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
          <span>
            {t("provider.id")}: <code className="font-mono">{provider.id}</code>
          </span>
          <span>
            {t("provider.status")}:{" "}
            <span className={provider.configured ? "text-green-400" : "text-muted-foreground"}>
              {provider.configured ? t("provider.ready") : t("provider.missingKey")}
            </span>
          </span>
          {/* Model context limit display — mirrors cc-switch's PresetModelVariant display */}
          {modelVariants && (
            <span className="text-muted-foreground">
              {t("provider.contextLimitLabel", {
                limit:
                  modelVariants.find((v) => v.id === model)?.contextLimit?.toLocaleString() ?? "—",
              })}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {t("provider.model")}:
          </span>
          {catalog ? (
            <Select
              value={model}
              onValueChange={(v) => {
                setEditing(true)
                setModelState(v)
              }}
              disabled={!provider.configured}
            >
              <SelectTrigger className="h-8 text-xs flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {catalog.map((m) => {
                  const variant = modelVariants?.find((v) => v.id === m)
                  const label = variant?.name ?? m
                  const ctxLimit = variant?.contextLimit
                  return (
                    <SelectItem key={m} value={m}>
                      {label}
                      {ctxLimit && (
                        <span className="text-muted-foreground ml-1">
                          ({ctxLimit.toLocaleString()} ctx)
                        </span>
                      )}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          ) : (
            <Input
              className="h-8 text-xs flex-1"
              value={model}
              onChange={(e) => {
                setEditing(true)
                setModelState(e.target.value)
              }}
              onBlur={handleBlur}
              disabled={!provider.configured}
            />
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={!provider.configured || isMutating || model === provider.defaultModel}
            onClick={async () => {
              const chosen = model
              await onSaveModel(chosen)
              // Mark this model as the "last saved" snapshot before exiting
              // edit mode. The effect above compares against this ref so a
              // brief gap where the refetched `provider.defaultModel` is
              // still the OLD value won't reset the dropdown back.
              savedModelRef.current = chosen
              setEditing(false)
            }}
          >
            {isMutating ? t("provider.saving") : t("provider.save")}
          </Button>
        </div>

        {/* Action buttons row — mirrors cc-switch's ProviderActions */}
        <div className="flex items-center gap-2 pt-1">
          {/* Reset circuit breaker */}
          {cbState && cbState !== "closed" && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs gap-1"
              onClick={() => resetCircuit.mutate({ providerId: provider.id })}
              disabled={resetCircuit.isPending}
            >
              <Zap className="w-3 h-3" />
              {t("provider.resetCircuit")}
            </Button>
          )}

          {/* Toggle failover queue */}
          {provider.inFailoverQueue ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => removeFromFailover.mutate({ providerId: provider.id })}
              disabled={removeFromFailover.isPending}
            >
              {t("provider.failover.remove")}
            </Button>
          ) : (
            autoFailoverEnabled && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs gap-1"
                onClick={() =>
                  addToFailover.mutate({
                    providerId: provider.id,
                    priority: provider.failoverPriority ?? 99,
                  })
                }
                disabled={addToFailover.isPending}
              >
                <Zap className="w-3 h-3" />
                {t("provider.failover.add")}
              </Button>
            )
          )}
        </div>
      </CardContent>
    </Card>
  )
}
