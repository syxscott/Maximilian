// @ts-nocheck
import React, { useMemo, useState } from "react"
import { Box, Text, useInput } from "ink"
import TextInput from "ink-text-input"
import SelectInput from "ink-select-input"

export type ProviderInfo = {
  id: string
  name: string
  models: Record<string, ModelInfo>
}

export type ModelInfo = {
  id?: string
  name?: string
  status?: string
  release_date?: string
  cost?: { input?: number; output?: number }
  providerID?: string
}

export type ModelFavorite = {
  providerID: string
  modelID: string
}

export type DialogModelProps = {
  providers: ProviderInfo[]
  connected?: boolean
  favorites?: ModelFavorite[]
  recents?: ModelFavorite[]
  providerID?: string
  current?: { providerID: string; modelID: string }
  query?: string
  onSelect?: (providerID: string, modelID: string) => void
  onChangeQuery?: (query: string) => void
  onToggleFavorite?: (model: ModelFavorite) => void
  onOpenProviders?: () => void
}

type SelectItem = {
  label: string
  value: { providerID: string; modelID: string }
  description?: string
  disabled?: boolean
}

function fuzzyScore(needle: string, hay: string | undefined): number {
  if (!hay) return 0
  const n = needle.toLowerCase()
  const h = hay.toLowerCase()
  if (h.includes(n)) return 100 - h.indexOf(n)
  let score = 0
  let i = 0
  for (const ch of h) {
    if (i < n.length && ch === n[i]) {
      score += 5
      i += 1
    }
  }
  return i === n.length ? score : 0
}

export function sortModelOptions<
  T extends { footer?: string; releaseDate?: string | number; title: string },
>(options: T[], newestFirst: boolean): T[] {
  const copy = [...options]
  if (newestFirst) {
    return copy.sort((a, b) => {
      const ar = a.releaseDate ?? ""
      const br = b.releaseDate ?? ""
      if (ar !== br) return br < ar ? -1 : 1
      return a.title.localeCompare(b.title)
    })
  }
  return copy.sort((a, b) => {
    const aFree = a.footer === "Free"
    const bFree = b.footer === "Free"
    if (aFree !== bFree) return aFree ? -1 : 1
    return a.title.localeCompare(b.title)
  })
}

export function DialogModel(props: DialogModelProps) {
  const [query, setQuery] = useState(props.query ?? "")

  const items: SelectItem[] = useMemo(() => {
    const needle = query.trim()
    const showSections = props.connected && !props.providerID && needle.length === 0
    const favorites = props.connected ? props.favorites ?? [] : []
    const recents = props.recents ?? []

    const favoriteOptions: SelectItem[] = showSections
      ? favorites.flatMap((item) => {
          const provider = props.providers.find((p) => p.id === item.providerID)
          if (!provider) return []
          const model = provider.models[item.modelID]
          if (!model) return []
          return [
            {
              label: model.name ?? item.modelID,
              value: { providerID: provider.id, modelID: model.id ?? item.modelID },
              description: provider.name,
              disabled: provider.id === "opencode" && (model.id ?? "").includes("-nano"),
            },
          ]
        })
      : []

    const recentOptions: SelectItem[] = showSections
      ? recents
          .filter(
            (item) =>
              !favorites.some(
                (fav) => fav.providerID === item.providerID && fav.modelID === item.modelID,
              ),
          )
          .flatMap((item) => {
            const provider = props.providers.find((p) => p.id === item.providerID)
            if (!provider) return []
            const model = provider.models[item.modelID]
            if (!model) return []
            return [
              {
                label: model.name ?? item.modelID,
                value: { providerID: provider.id, modelID: model.id ?? item.modelID },
                description: provider.name,
                disabled: provider.id === "opencode" && (model.id ?? "").includes("-nano"),
              },
            ]
          })
      : []

    const providerOptions: SelectItem[] = props.providers
      .slice()
      .sort((a, b) => {
        const aIsOC = a.id === "opencode" ? 0 : 1
        const bIsOC = b.id === "opencode" ? 0 : 1
        if (aIsOC !== bIsOC) return aIsOC - bIsOC
        return a.name.localeCompare(b.name)
      })
      .flatMap((provider) => {
        return Object.entries(provider.models)
          .filter(([_, info]) => info.status !== "deprecated")
          .filter(([_, info]) =>
            props.providerID ? info.providerID === props.providerID : true,
          )
          .map(([modelID, info]) => {
            const id = info.id ?? modelID
            const isFavorite = favorites.some(
              (fav) => fav.providerID === provider.id && fav.modelID === modelID,
            )
            const isRecent = recents.some(
              (item) => item.providerID === provider.id && item.modelID === modelID,
            )
            const isFree = info.cost?.input === 0 && provider.id === "opencode"
            return {
              label: info.name ?? modelID,
              value: { providerID: provider.id, modelID: id },
              description: isFavorite ? "(Favorite)" : undefined,
              disabled: provider.id === "opencode" && id.includes("-nano"),
              footer: isFree ? "Free" : undefined,
              _releaseDate: info.release_date,
              _showSections: showSections,
              _isFavorite: isFavorite,
              _isRecent: isRecent,
            } as SelectItem & {
              footer?: string
              _releaseDate?: string
              _showSections?: boolean
              _isFavorite?: boolean
              _isRecent?: boolean
            }
          })
          .filter((option) => {
            if (!showSections) return true
            const o = option as SelectItem & { _isFavorite?: boolean; _isRecent?: boolean }
            if (o._isFavorite) return false
            if (o._isRecent) return false
            return true
          })
          .map(({ _releaseDate, _showSections, _isFavorite, _isRecent, ...rest }) => {
            void _showSections
            void _isFavorite
            void _isRecent
            return { ...rest, _releaseDate } as SelectItem & { _releaseDate?: string; footer?: string }
          })
      })

    const sortedProvider = sortModelOptions(
      providerOptions as Array<SelectItem & { footer?: string; title: string; _releaseDate?: string }>,
      props.providerID !== undefined,
    ).map((opt) => {
      const { _releaseDate, ...rest } = opt as SelectItem & { _releaseDate?: string }
      void _releaseDate
      return rest as SelectItem
    })

    const all: SelectItem[] = [...favoriteOptions, ...recentOptions, ...sortedProvider]

    if (needle) {
      const scored = all
        .map((opt) => ({
          opt,
          score: Math.max(fuzzyScore(needle, opt.label), fuzzyScore(needle, opt.description) / 2),
        }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry.opt)
      return scored
    }
    return all
  }, [props.providers, props.connected, props.providerID, props.favorites, props.recents, query])

  const title = useMemo(() => {
    if (!props.providerID) return "Select model"
    const p = props.providers.find((item) => item.id === props.providerID)
    return p?.name ?? "Select model"
  }, [props.providerID, props.providers])

  const handleSelect = (item: SelectItem) => {
    if (item.disabled) return
    props.onSelect?.(item.value.providerID, item.value.modelID)
  }

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>{title}</Text>
        <Text dimColor>esc</Text>
      </Box>
      <Box marginY={1}>
        <Text>Search: </Text>
        <TextInput
          value={query}
          onChange={(v) => {
            setQuery(v)
            props.onChangeQuery?.(v)
          }}
        />
      </Box>
      <Box>
        <SelectInput
          items={items}
          onSelect={handleSelect}
          itemComponent={({ isSelected, label, value }) => (
            <Box flexDirection="row">
              <Text color={isSelected ? "green" : undefined}>{label}</Text>
              {props.current?.providerID === value.providerID && props.current?.modelID === value.modelID && (
                <Text dimColor> (current)</Text>
              )}
            </Box>
          )}
        />
      </Box>
    </Box>
  )
}

export default DialogModel
