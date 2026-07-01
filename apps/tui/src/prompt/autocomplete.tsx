// @ts-nocheck
/**
 * Autocomplete dropdown for `@mentions` and `/commands`.
 *
 * Ported from OpenCode's `prompt/autocomplete.tsx`. The original used a
 * custom `<scrollbox>` overlay anchored to the textarea; we render a simpler
 * list above the prompt when active.
 *
 * The component is intentionally API-compatible with the OpenCode version so
 * the existing `Prompt` parent can reuse the same `setPrompt` / `setExtmark`
 * callbacks.
 */

import { useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from "react"
import { Box, Text } from "ink"
import fuzzysort from "fuzzysort"
import { useSync } from "../context/sync"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"

export type AutocompleteRef = {
  visible: false | "@" | "/"
  onInput: (value: string) => void
}

export type AutocompleteOption = {
  display: string
  value?: string
  aliases?: string[]
  disabled?: boolean
  description?: string
  isDirectory?: boolean
  onSelect?: () => void
  path?: string
}

type PromptInfoShape = { input: string; parts: Array<{ type: string; [k: string]: unknown }> }

export type AutocompleteProps = {
  value: string
  sessionID?: string
  setPrompt: (updater: (draft: PromptInfoShape) => void) => void
  setExtmark: (partIndex: number, extmarkId: number) => void
  anchor: () => { x: number; y: number; width: number }
  input: () => {
    getTextRange: (start: number, end: number) => string
    cursorOffset: number
    plainText: string
  }
  ref?: (ref: AutocompleteRef | undefined) => void
  fileStyleId: number
  agentStyleId: number
  promptPartTypeId: () => number
}

export const Autocomplete = forwardRef<AutocompleteRef | undefined, AutocompleteProps>(function Autocomplete(props, forwardedRef) {
  const sync = useSync()
  const sdk = useSDK()
  const { theme } = useTheme()

  const [visible, setVisible] = useState<false | "@" | "/">(false)
  const [triggerIndex, setTriggerIndex] = useState(0)
  const [selected, setSelected] = useState(0)
  const [files, setFiles] = useState<AutocompleteOption[]>([])

  const handle = useRef<AutocompleteRef | undefined>(undefined)

  // -- Search ---------------------------------------------------------------
  const query = useMemo(() => {
    if (!visible) return ""
    return props.input().getTextRange(triggerIndex + 1, props.input().cursorOffset)
  }, [visible, triggerIndex, props.value, props])

  useEffect(() => {
    if (visible !== "@") {
      setFiles([])
      return
    }
    let cancelled = false
    const t = setTimeout(() => {
      sdk.client
        .get<{ data: Array<{ path: string; type: string }> }>(`/fs/find?query=${encodeURIComponent(query)}&limit=20`)
        .then((res) => {
          if (cancelled) return
          const width = Math.max(40, props.anchor().width - 4)
          setFiles(
            (res.data ?? []).map((item) => ({
              display: item.path.length > width ? item.path.slice(0, width - 1) + "…" : item.path,
              value: item.path,
              isDirectory: item.type === "directory",
              path: item.path,
              onSelect: () => insertPart(item.path),
            })),
          )
        })
        .catch(() => {
          if (!cancelled) setFiles([])
        })
    }, 80)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query, visible, sdk, props])

  // -- Option lists ---------------------------------------------------------

  const agents = useMemo<AutocompleteOption[]>(
    () =>
      (sync.data.agent as Array<{ name: string; hidden?: boolean; mode?: string }>)
        .filter((a) => !a.hidden && a.mode !== "primary")
        .map((a) => ({
          display: `@${a.name}`,
          onSelect: () =>
            insertPart(a.name, {
              type: "agent",
              name: a.name,
              source: { start: 0, end: 0, value: "" },
            }),
        })),
    [sync.data.agent],
  )

  const commands = useMemo<AutocompleteOption[]>(
    () =>
      (sync.data.command as Array<{ name: string; description?: string; source?: string }>)
        .filter((c) => c.source !== "skill")
        .map((c) => ({
          display: `/${c.name}`,
          description: c.description,
          onSelect: () => {
            // Replace input text with the command + trailing space.
            props.setPrompt((draft) => {
              draft.input = `/${c.name} `
              draft.parts = []
            })
          },
        })),
    [sync.data.command],
  )

  // -- Option assembly ------------------------------------------------------

  const options = useMemo<AutocompleteOption[]>(() => {
    if (!visible) return []
    const list = visible === "/" ? commands : [...agents, ...files]
    if (!query) return list.slice(0, 10)
    const fuzzied = fuzzysort.go(query, list, {
      keys: [
        (obj) => (obj.value ?? obj.display).trimEnd(),
        ...(visible === "/" ? ["description" as const] : []),
      ],
      threshold: visible === "@" ? 0.5 : 0,
      limit: 10,
    })
    return fuzzied.map((r) => r.obj)
  }, [visible, agents, files, commands, query])

  useEffect(() => {
    setSelected(0)
  }, [options.length])

  // -- Insertion ------------------------------------------------------------

  function insertPart(text: string, part?: PromptInfoShape["parts"][number]) {
    const next = `@${text} `
    const plain = props.input().plainText
    const head = plain.slice(0, triggerIndex)
    props.setPrompt((draft) => {
      draft.input = head + next
      if (part) draft.parts.push(part)
    })
    setVisible(false)
    void plain
  }

  function select() {
    const choice = options[selected]
    if (!choice) return
    setVisible(false)
    choice.onSelect?.()
  }

  // -- Public API -----------------------------------------------------------

  useImperativeHandle(forwardedRef, () => ({
    get visible() {
      return visible
    },
    onInput(value: string) {
      const offset = value.length
      if (offset === 0) return
      if (value.startsWith("/") && !value.slice(0, offset).match(/\s/)) {
        setVisible("/")
        setTriggerIndex(0)
        return
      }
      const idx = value.lastIndexOf("@", offset - 1)
      if (idx !== -1 && !value.slice(idx, offset).match(/\s/)) {
        setVisible("@")
        setTriggerIndex(idx)
      }
    },
  }))

  // Mirror the imperative API onto the parent's `ref` prop.
  useEffect(() => {
    handle.current = {
      get visible() {
        return visible
      },
      onInput(value: string) {
        const offset = value.length
        if (offset === 0) return
        if (value.startsWith("/") && !value.slice(0, offset).match(/\s/)) {
          setVisible("/")
          setTriggerIndex(0)
          return
        }
        const idx = value.lastIndexOf("@", offset - 1)
        if (idx !== -1 && !value.slice(idx, offset).match(/\s/)) {
          setVisible("@")
          setTriggerIndex(idx)
        }
      },
    }
    props.ref?.(handle.current)
    return () => props.ref?.(undefined)
  }, [visible, props])

  if (!visible || options.length === 0) return null

  return (
    <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={theme.border} paddingLeft={1} paddingRight={1}>
      {options.map((option, index) => (
        <Box key={option.display + index} flexDirection="row">
          <Text color={index === selected ? theme.primary : theme.text}>
            {option.display}
            {option.description ? <Text color={theme.textMuted}>  {option.description}</Text> : null}
          </Text>
        </Box>
      ))}
    </Box>
  )
})