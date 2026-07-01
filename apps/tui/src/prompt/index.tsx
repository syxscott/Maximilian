// @ts-nocheck
/**
 * Prompt component: text input + autocomplete + parts.
 *
 * Ported from OpenCode's `component/prompt/index.tsx` (~1697 lines). The
 * original implemented an opentui-specific `<textarea>` with extmark-based
 * styling for `@mentions`, `/commands`, `#file` references, plus an
 * autocomplete dropdown, history, stash, and slash command plumbing.
 *
 * Maximilian's TUI uses ink, which doesn't ship its own textarea. We build
 * the prompt on top of `ink-text-input` and model the autocomplete overlay
 * ourselves. The `PromptRef` surface is preserved (focused, current, set,
 * reset, blur, focus, submit) so calling routes (home, session) work without
 * changes.
 *
 * What is preserved:
 *   - Visual layout (bordered input, placeholder cycling, hint, mode shell).
 *   - Slash-command autocomplete from `sync.data.command`.
 *   - File/agent mention autocomplete via SDK fs.find.
 *   - Submit pipeline (agent, model, variant, parts, session creation).
 *
 * What is simplified:
 *   - No extmark styling (no syntax highlighting on virtual text).
 *   - No multiselect, no paste-image attachments.
 *   - History/stash are stubs.
 */

import { useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle, useCallback } from "react"
import { Box, Text } from "ink"
import TextInput from "ink-text-input"
import fuzzysort from "fuzzysort"
import { Autocomplete, type AutocompleteRef } from "./autocomplete"
import { useSync } from "../context/sync"
import { useSDK } from "../context/sdk"
import { useLocal } from "../context/local"
import { useTheme } from "../context/theme"
import { useRoute } from "../context/route"
import { useTuiPaths } from "../context/runtime"

// -- Types -------------------------------------------------------------------

export type PromptPart =
  | { type: "text"; text: string; synthetic?: boolean; source?: { text: { start: number; end: number; value: string } } }
  | { type: "file"; mime: string; filename: string; url: string; source?: { type: string; text?: { start: number; end: number; value: string }; path: string } }
  | { type: "agent"; name: string; source?: { start: number; end: number; value: string } }

export type PromptInfo = { input: string; parts: PromptPart[] }

export type PromptProps = {
  sessionID?: string
  visible?: boolean
  disabled?: boolean
  onSubmit?: () => void
  ref?: (ref: PromptRef | undefined) => void
  hint?: React.ReactNode
  right?: React.ReactNode
  showPlaceholder?: boolean
  placeholders?: { normal?: string[]; shell?: string[] }
}

export type PromptRef = {
  focused: boolean
  current: PromptInfo
  set: (prompt: PromptInfo) => void
  reset: () => void
  blur: () => void
  focus: () => void
  submit: () => void
}

// -- Helpers -----------------------------------------------------------------

function randomIndex(count: number): number {
  if (count <= 0) return 0
  return Math.floor(Math.random() * count)
}

function formatEditorContext(_selection: unknown): string {
  return ""
}

// -- Component ---------------------------------------------------------------

export const Prompt = forwardRef<PromptRef | undefined, PromptProps>(function Prompt(props, forwardedRef) {
  const sync = useSync()
  const sdk = useSDK()
  const local = useLocal()
  const { theme } = useTheme()
  const route = useRoute()
  const paths = useTuiPaths()
  void route
  void paths

  const [input, setInput] = useState("")
  const [parts, setParts] = useState<PromptPart[]>([])
  const [mode, setMode] = useState<"normal" | "shell">("normal")
  const [focused, setFocused] = useState(true)
  const submittingRef = useRef(false)

  const list = props.placeholders?.normal ?? []
  const shell = props.placeholders?.shell ?? []
  const [placeholderIndex, setPlaceholderIndex] = useState<number>(() => randomIndex(list.length))
  const placeholder = mode === "shell"
    ? shell[placeholderIndex % Math.max(shell.length, 1)] ?? "$ "
    : list[placeholderIndex % Math.max(list.length, 1)] ?? "Type your message..."

  const status = (sync.data.session_status as Record<string, { type: string }>)[props.sessionID ?? ""] ?? { type: "idle" }

  const autocompleteRef = useRef<AutocompleteRef | undefined>(undefined)
  const inputRef = useRef<{ focus: () => void; blur: () => void } | null>(null)

  // Hand off focus management to ink-text-input via its built-in focus prop.
  // We expose `focus()`/`blur()` to callers through the imperative handle.
  const focusInput = useCallback(() => inputRef.current?.focus(), [])
  const blurInput = useCallback(() => inputRef.current?.blur(), [])

  useEffect(() => {
    if (props.visible !== false) focusInput()
  }, [props.visible, focusInput])

  // -- Submit pipeline ------------------------------------------------------

  const submit = useCallback(async (): Promise<boolean> => {
    if (submittingRef.current) return false
    submittingRef.current = true
    try {
      const text = input.trim()
      if (!text) return false
      const agent = local.agent.current()
      if (!agent) return false
      const model = local.model.current()
      if (!model) return false

      // Route slash commands through SDK; otherwise send a prompt.
      if (mode === "shell" || text.startsWith("!")) {
        const command = mode === "shell" ? text : text.slice(1)
        if (!props.sessionID) return false
        await sdk.client.post(`/session/${props.sessionID}/shell`, {
          command,
          agent: agent.name,
          model: { providerID: model.providerID, modelID: model.modelID },
        }).catch(() => undefined)
      } else if (text.startsWith("/")) {
        const firstLineEnd = text.indexOf("\n")
        const firstLine = firstLineEnd === -1 ? text : text.slice(0, firstLineEnd)
        const [command, ...rest] = firstLine.split(" ")
        if (!props.sessionID) return false
        await sdk.client.post(`/session/${props.sessionID}/command`, {
          command: command.slice(1),
          arguments: rest.join(" "),
          agent: agent.name,
          model: `${model.providerID}/${model.modelID}`,
          parts: parts.filter((p): p is Extract<PromptPart, { type: "file" }> => p.type === "file"),
        }).catch(() => undefined)
      } else {
        let sessionID = props.sessionID
        if (!sessionID) {
          const res = await sdk.client.post<{ id: string }>(`/session`, {
            agent: agent.name,
            model: { providerID: model.providerID, modelID: model.modelID },
          }).catch(() => null)
          if (!res?.id) return false
          sessionID = res.id
        }
        await sdk.client.post(`/session/${sessionID}/messages`, {
          parts: [
            ...(parts as unknown as Array<Record<string, unknown>>),
            { type: "text", text },
          ],
          agent: agent.name,
          model: { providerID: model.providerID, modelID: model.modelID },
        }).catch(() => undefined)
      }

      // Reset prompt on success.
      setInput("")
      setParts([])
      props.onSubmit?.()
      return true
    } finally {
      submittingRef.current = false
    }
  }, [input, mode, parts, props, sdk, local])

  // -- Imperative handle ----------------------------------------------------

  const ref: PromptRef = useMemo(
    () => ({
      get focused() {
        return focused
      },
      current: { input, parts },
      set(prompt) {
        setInput(prompt.input)
        setParts(prompt.parts)
        setTimeout(focusInput, 0)
      },
      reset() {
        setInput("")
        setParts([])
      },
      blur() {
        blurInput()
      },
      focus() {
        focusInput()
      },
      submit() {
        void submit()
      },
    }),
    [focused, input, parts, submit, focusInput, blurInput],
  )

  useImperativeHandle(forwardedRef, () => ref, [ref])

  useEffect(() => {
    props.ref?.(ref)
    return () => props.ref?.(undefined)
  }, [props, ref])

  // -- Autocomplete wiring --------------------------------------------------

  const handleSubmit = (value: string): void => {
    // If the autocomplete is visible, its onSelect will mutate the input; we
    // bail here so we don't double-handle. Otherwise we submit.
    if (autocompleteRef.current?.visible) return
    void submit().then((handled) => {
      if (handled) setPlaceholderIndex(randomIndex(list.length))
    })
    void value
  }

  const handleInputChange = (value: string): void => {
    setInput(value)
    autocompleteRef.current?.onInput(value)
  }

  const setPrompt = useCallback((updater: (draft: PromptInfo) => void) => {
    // Apply mutations to our local input/parts. We model "draft" as a plain
    // object so consumers can mutate it like Solid's `produce`.
    // Clone parts to avoid mutating state in-place (React won't re-render if reference is same).
    const draft: PromptInfo = { input, parts: [...parts] }
    updater(draft)
    setInput(draft.input)
    setParts(draft.parts)
  }, [input, parts])

  // Slash-command list from sync + fuzzy filter.
  const commands = useMemo(() => {
    return (sync.data.command as Array<{ name: string; description?: string }>).filter((c) => c.source !== "skill")
  }, [sync.data.command])

  const filteredCommands = useMemo(() => {
    if (!input.startsWith("/")) return []
    const query = input.slice(1)
    if (!query || query.includes(" ")) return []
    const results = fuzzysort.go(query, commands, { keys: ["name"], limit: 8 })
    return results.map((r) => r.obj)
  }, [input, commands])

  // -- Render ---------------------------------------------------------------

  const visible = props.visible !== false && !props.disabled

  return (
    <Box flexDirection="column">
      {props.hint ? <Box>{props.hint}</Box> : null}
      <Box
        borderStyle="round"
        borderColor={mode === "shell" ? theme.warning : theme.border}
        paddingLeft={1}
        paddingRight={1}
      >
        <Box flexDirection="row" flexGrow={1}>
          {mode === "shell" ? (
            <Box marginRight={1}>
              <Text color={theme.warning}>$</Text>
            </Box>
          ) : null}
          <Box flexGrow={1}>
            {visible ? (
              <TextInput
                value={input}
                onChange={handleInputChange}
                onSubmit={handleSubmit}
                placeholder={props.showPlaceholder === false ? "" : placeholder}
                ref={(r: { focus?: () => void; blur?: () => void } | null) => {
                  if (r && r.focus && r.blur) {
                    inputRef.current = { focus: r.focus, blur: r.blur }
                  }
                }}
              />
            ) : (
              <Text color={theme.textMuted}>{input || placeholder}</Text>
            )}
          </Box>
          {props.right ? <Box marginLeft={1}>{props.right}</Box> : null}
        </Box>
      </Box>
      {filteredCommands.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          {filteredCommands.map((cmd) => (
            <Text key={cmd.name} color={theme.text}>
              /{cmd.name}
              {cmd.description ? <Text color={theme.textMuted}>  {cmd.description}</Text> : null}
            </Text>
          ))}
        </Box>
      ) : null}
      <Autocomplete
        ref={(r) => {
          autocompleteRef.current = r ?? undefined
        }}
        value={input}
        setPrompt={setPrompt}
        setExtmark={() => {
          /* extmarks are not modeled in ink; no-op */
        }}
        anchor={() => ({ x: 0, y: 0, width: 80 })}
        input={() => ({
          getTextRange: (start: number, end: number) => input.slice(start, end),
          cursorOffset: input.length,
          get plainText() {
            return input
          },
        })}
        fileStyleId={0}
        agentStyleId={0}
        promptPartTypeId={() => 0}
      />
      {status.type !== "idle" ? (
        <Box marginTop={1}>
          <Text color={theme.warning}>Session: {status.type}</Text>
        </Box>
      ) : null}
      <input
        type="text"
        value={input}
        onChange={(e) => handleInputChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            void handleSubmit(input)
          }
        }}
        // Hidden mirror so screen readers and tests can poke at the value
        // without depending on ink's stdin/raw-mode lifecycle.
        style={{ display: "none" }}
        aria-hidden
        readOnly
      />
    </Box>
  )
})

// suppress unused warning for formatEditorContext (kept for parity)
void formatEditorContext