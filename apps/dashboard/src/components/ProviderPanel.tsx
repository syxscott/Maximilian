import { useEffect, useState } from "react"
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
import { useProviders, useSetDefaultProvider, useSetProviderModel } from "@/lib/api/hooks"
import { useLocale, t } from "@max/i18n"
import { VirtualList } from "./VirtualList"
import type { ProviderInfo } from "@/api"

/**
 * Per-provider model candidates. The Provider interface doesn't expose a
 * model catalog yet — these are common defaults for the known provider ids.
 * Unknown providers fall back to a free-text input so the UI doesn't block
 * switching to a model that's not in this hardcoded list.
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
  const catalog = PROVIDER_MODEL_CATALOG[provider.id]
  const [model, setModelState] = useState(provider.defaultModel)
  const [editing, setEditing] = useState(false)

  // If the provider's effective model changes externally (e.g. another tab),
  // reflect it in the local input. The previous implementation called
  // `setModelState` directly during render, which is a React anti-pattern:
  // it forces a synchronous re-render mid-render and (without a guard
  // such as the `model !== provider.defaultModel` check here) can cascade
  // into an infinite re-render loop. The `useEffect` + `editing` guard
  // is the standard pattern: only sync from prop when the user is not
  // actively editing the input.
  useEffect(() => {
    if (!editing && model !== provider.defaultModel) {
      setModelState(provider.defaultModel)
    }
    // `editing` is reset to false on save (below) and on blur of the
    // freeform Input. The Select's onValueChange sets editing=true so a
    // fresh prop value won't clobber the user's choice; saving resets it
    // so the next render can sync again.
  }, [provider.defaultModel, editing, model])

  const handleBlur = () => {
    // Drop the editing guard on blur so an external prop update (e.g.
    // another tab saved a different model) can take effect when the user
    // comes back to this row. Without this, editing stayed true forever
    // once the user touched the field, freezing the displayed value even
    // if the backend had long since changed.
    setEditing(false)
  }

  return (
    <Card className={`bg-muted/30 ${isDefault ? "border-primary" : "border-border/50"}`}>
      <CardHeader className="py-3 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base text-foreground">{provider.name}</CardTitle>
            {isDefault && <Badge variant="default">{t("provider.default")}</Badge>}
            <Badge variant={provider.configured ? "outline" : "secondary"}>
              {provider.configured ? t("provider.configured") : t("provider.notConfigured")}
            </Badge>
          </div>
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
      </CardHeader>
      <CardContent className="py-2 px-4 space-y-2">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>
            {t("provider.id")}: <code className="font-mono">{provider.id}</code>
          </span>
          <span>
            {t("provider.status")}:{" "}
            <span className={provider.configured ? "text-green-400" : "text-muted-foreground"}>
              {provider.configured ? t("provider.ready") : t("provider.missingKey")}
            </span>
          </span>
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
                {catalog.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
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
              await onSaveModel(model)
              setEditing(false)
            }}
          >
            {isMutating ? t("provider.saving") : t("provider.save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
