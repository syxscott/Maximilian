// @ts-nocheck
import React, { useEffect, useMemo, useState } from "react"
import { t } from "@max/i18n"
import { Box, Text, useInput } from "ink"
import TextInput from "ink-text-input"
import SelectInput from "ink-select-input"

const PROVIDER_PRIORITY: Record<string, number> = {
  opencode: 0,
  "opencode-go": 1,
  openai: 2,
  "github-copilot": 3,
  anthropic: 4,
  google: 5,
}

const CUSTOM_PROVIDER_OPTION_VALUE = "__opencode_custom_provider__"
const CUSTOM_PROVIDER_ID = /^[a-z0-9][a-z0-9-_]*$/

type ProviderOptionBase = {
  title: string
  value: string
  description?: string
}

export type ProviderInfo = {
  id: string
  name: string
}

export type ProviderOption =
  | (ProviderOptionBase & { type: "provider"; providerID: string })
  | (ProviderOptionBase & { type: "custom" })

export type ProviderAuthMethod = {
  type: "api" | "oauth"
  label: string
  prompts?: Array<{
    key: string
    message: string
    placeholder?: string
    type?: "text" | "select"
    options?: Array<{ label: string; value: string; hint?: string }>
    when?: { key: string; op: "eq" | "ne"; value: string }
  }>
}

export type ProviderAuthAuthorization = {
  url: string
  instructions: string
  method?: "code" | "auto"
}

export function normalizeCustomProviderID(value: string): string | undefined {
  const providerID = value.trim().replace(/^@ai-sdk\//, "")
  if (!CUSTOM_PROVIDER_ID.test(providerID)) return undefined
  return providerID
}

export function providerOptions(list: ProviderInfo[]): ProviderOption[] {
  return [
    ...[...list]
      .sort((a, b) => {
        const pa = PROVIDER_PRIORITY[a.id] ?? 99
        const pb = PROVIDER_PRIORITY[b.id] ?? 99
        if (pa !== pb) return pa - pb
        const an = a.name.toLowerCase()
        const bn = b.name.toLowerCase()
        if (an !== bn) return an < bn ? -1 : 1
        return a.id.localeCompare(b.id)
      })
      .map((provider) => ({
        type: "provider" as const,
        title: provider.name,
        value: provider.id,
        providerID: provider.id,
        description: {
          opencode: "(Recommended)",
          anthropic: "(API key)",
          openai: "(ChatGPT Plus/Pro or API key)",
          "opencode-go": "Low cost subscription for everyone",
        }[provider.id],
      })),
    {
      type: "custom" as const,
      title: "Other",
      value: CUSTOM_PROVIDER_OPTION_VALUE,
      description: "Custom provider",
    },
  ]
}

export type DialogProviderOptionItem = {
  label: string
  value: string
  description?: string
  category?: string
  onSelect?: () => void
}

export type DialogProviderProps = {
  providers: ProviderInfo[]
  connectedProviderIDs?: string[]
  onboarded?: boolean
  onSelectProvider?: (providerID: string) => void
  onSelectCustom?: () => void
}

export function DialogProvider(props: DialogProviderProps) {
  const items: DialogProviderOptionItem[] = useMemo(() => {
    return providerOptions(props.providers).map((provider) => {
      if (provider.type === "custom") {
        return {
          label: provider.title,
          value: provider.value,
          description: provider.description,
          category: "Providers",
          onSelect: () => props.onSelectCustom?.(),
        }
      }
      const connected = props.connectedProviderIDs?.includes(provider.providerID)
      return {
        label: provider.title,
        value: provider.value,
        description: provider.description,
        category: provider.providerID in PROVIDER_PRIORITY ? "Popular" : "Providers",
        onSelect: () => props.onSelectProvider?.(provider.providerID),
      }
    })
  }, [props.providers, props.connectedProviderIDs, props.onSelectProvider, props.onSelectCustom])

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>{t("tui.connectAProvider")}</Text>
        <Text dimColor>esc</Text>
      </Box>
      <Box marginTop={1}>
        <SelectInput
          items={items}
          onSelect={(item) => item.onSelect?.()}
          itemComponent={({ isSelected, label }) => (
            <Text color={isSelected ? "green" : undefined}>{label}</Text>
          )}
        />
      </Box>
    </Box>
  )
}

export type AutoMethodProps = {
  index: number
  providerID: string
  title: string
  authorization: ProviderAuthAuthorization
  onAwaitCallback?: () => void | Promise<void>
  onError?: (message: string) => void
  onCopyCode?: (code: string) => void
}

export function AutoMethod(props: AutoMethodProps) {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 1000)
    return () => clearInterval(t)
  }, [])

  useInput((input, key) => {
    if (input === "c") {
      const match = props.authorization.instructions.match(/[A-Z0-9]{4}-[A-Z0-9]{4,5}/)
      const code = match?.[0] ?? props.authorization.url
      props.onCopyCode?.(code)
    }
  })

  useEffect(() => {
    void props.onAwaitCallback?.()
  }, [])

  return (
    <Box flexDirection="column" paddingX={2} paddingBottom={1} gap={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>{props.title}</Text>
        <Text dimColor>esc</Text>
      </Box>
      <Box flexDirection="column" gap={1}>
        <Text color="blue">{props.authorization.url}</Text>
        <Text dimColor>{props.authorization.instructions}</Text>
      </Box>
      <Text dimColor>Waiting for authorization... {tick}s</Text>
      <Box>
        <Text>
          c <Text dimColor>copy</Text>
        </Text>
      </Box>
    </Box>
  )
}

export type CodeMethodProps = {
  index: number
  title: string
  providerID: string
  authorization: ProviderAuthAuthorization
  onSubmit?: (code: string) => Promise<boolean>
  onCancel?: () => void
}

export function CodeMethod(props: CodeMethodProps) {
  const [code, setCode] = useState("")
  const [error, setError] = useState(false)

  useInput((input, key) => {
    if (key.escape) props.onCancel?.()
  })

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} gap={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>{props.title}</Text>
        <Text dimColor>esc</Text>
      </Box>
      <Box flexDirection="column" gap={1}>
        <Text dimColor>{props.authorization.instructions}</Text>
        <Text color="blue">{props.authorization.url}</Text>
        {error && <Text color="red">{t("tui.invalidCode")}</Text>}
      </Box>
      <Box>
        <Text>Code: </Text>
        <TextInput
          value={code}
          onChange={setCode}
          onSubmit={async (value) => {
            const ok = await props.onSubmit?.(value)
            if (!ok) setError(true)
          }}
        />
      </Box>
    </Box>
  )
}

export type ApiMethodProps = {
  providerID: string
  title: string
  metadata?: Record<string, string>
  custom?: boolean
  description?: React.ReactNode
  onSubmit?: (key: string) => void | Promise<void>
  onCancel?: () => void
}

export function ApiMethod(props: ApiMethodProps) {
  const [value, setValue] = useState("")

  useInput((input, key) => {
    if (key.escape) props.onCancel?.()
  })

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} gap={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>{props.title}</Text>
        <Text dimColor>esc</Text>
      </Box>
      {props.description ? <Box>{props.description}</Box> : null}
      <Box>
        <Text>API key: </Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={(v) => {
            if (!v.trim()) return
            void props.onSubmit?.(v.trim())
          }}
        />
      </Box>
    </Box>
  )
}

export type PromptItem = {
  label: string
  value: string
  description?: string
}

export type DialogPromptProps = {
  title: string
  placeholder?: string
  initialValue?: string
  description?: React.ReactNode
  options?: PromptItem[]
  onConfirm?: (value: string) => void | Promise<void>
  onCancel?: () => void
}

export function DialogPrompt(props: DialogPromptProps) {
  const [value, setValue] = useState(props.initialValue ?? "")

  useInput((input, key) => {
    if (key.escape) props.onCancel?.()
  })

  if (props.options && props.options.length > 0) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold>{props.title}</Text>
          <Text dimColor>esc</Text>
        </Box>
        {props.description && <Box marginY={1}>{props.description}</Box>}
        <Box marginTop={1}>
          <SelectInput
            items={props.options.map((o) => ({ label: o.label, value: o.value }))}
            onSelect={(item) => void props.onConfirm?.(item.value)}
          />
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>{props.title}</Text>
        <Text dimColor>esc</Text>
      </Box>
      {props.description && <Box marginY={1}>{props.description}</Box>}
      <Box>
        <Text>{props.placeholder ?? "Value"}: </Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={(v) => void props.onConfirm?.(v)}
        />
      </Box>
    </Box>
  )
}

DialogPrompt.show = (
  props: DialogPromptProps,
): Promise<string | null> => {
  return new Promise((resolve) => {
    resolve(null)
    void props
  })
}

export default DialogProvider
