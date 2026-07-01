// @ts-nocheck
/**
 * Session route: transcript viewer + prompt + sidebar.
 *
 * Ported from OpenCode's `routes/session/index.tsx` (2648 lines). The original
 * used `@opentui/solid` primitives (`<scrollbox>`, `<markdown>`, `<diff>`,
 * `<code>`) plus a deep command-palette/keymap system. We rewrite to plain
 * ink primitives and split rendering into focused helper components.
 *
 * NOTE: this is a structural port, not a 1:1 translation. Several pieces are
 * stubbed or simplified:
 *   - Markdown rendering uses plain `<Text>` (no syntax highlighting).
 *   - Diffs render as raw text blocks (no split/stacked view).
 *   - Tool part rendering is summarized inline; full per-tool UI is deferred.
 *   - Keybindings/command palette fall back to no-op handlers.
 *
 * Routing of session messages, prompt submission, and status remain
 * faithful to the OpenCode intent.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Box, Text } from "ink"
import { Prompt, type PromptRef } from "../../prompt"
import { useRoute, useRouteData } from "../../context/route"
import { useSync } from "../../context/sync"
import { useEvent } from "../../context/event"
import { useSDK } from "../../context/sdk"
import { useLocal } from "../../context/local"
import { useTheme } from "../../context/theme"
import { useArgs } from "../../context/args"

// -- Types mirroring the OpenCode SDK shapes we read -------------------------

type SessionStatus = { type: string; message?: string; attempt?: number; action?: unknown }

type Session = {
  id: string
  title?: string
  parentID?: string
  directory?: string
  share?: { url: string }
  revert?: { messageID?: string; diff?: string }
  cost?: number
  time?: { compacting?: boolean; updated?: number; created?: number }
}

type Part =
  | { type: "text"; text: string; synthetic?: boolean; ignored?: boolean }
  | { type: "reasoning"; text: string; time: { start: number; end?: number } }
  | {
      type: "tool"
      tool: string
      callID: string
      state: { status: string; input?: Record<string, unknown>; output?: string; metadata?: Record<string, unknown>; time?: { compacted?: boolean } }
    }
  | { type: "file"; mime: string; filename: string; url: string }
  | { type: "compaction" }

type Message = {
  id: string
  sessionID: string
  role: "user" | "assistant"
  parentID?: string
  agent?: string
  model?: { providerID: string; modelID: string; variant?: string }
  providerID?: string
  modelID?: string
  mode?: string
  error?: { name: string; data?: { message?: string }; message?: string }
  finish?: string
  time: { created: number; completed?: number }
  tokens?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
}

type PromptInfo = { input: string; parts: Array<{ type: string; [k: string]: unknown }> }

// -- Helpers -----------------------------------------------------------------

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function inputSummary(input: Record<string, unknown>, omit?: string[]): string {
  const primitives = Object.entries(input).filter(([key, value]) => {
    if (omit?.includes(key)) return false
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
  })
  if (primitives.length === 0) return ""
  return `[${primitives.map(([key, value]) => `${key}=${value}`).join(", ")}]`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}m${r}s`
}

function formatTodayOrDate(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  }
  return d.toLocaleString()
}

// -- Sub-components ----------------------------------------------------------

function ReasoningHeader({ part, open, toggleable }: { part: { text: string; time: { end?: number } }; open: boolean; toggleable: boolean }) {
  const { theme } = useTheme()
  const done = part.time.end !== undefined
  if (!done) {
    return (
      <Text>
        <Text color={theme.warning}>Thinking…</Text>
      </Text>
    )
  }
  return (
    <Text color={theme.warning}>
      {toggleable ? (open ? "- " : "+ ") : ""}Thought: {part.text.slice(0, 80)}
      {part.text.length > 80 ? "…" : ""}
    </Text>
  )
}

function ReasoningPart({ part }: { part: Extract<Part, { type: "reasoning" }> }) {
  const { theme } = useTheme()
  const [open, setOpen] = useState(false)
  const content = part.text.replace("[REDACTED]", "").trim()
  if (!content) return null
  const duration = part.time.end !== undefined ? Math.max(0, part.time.end - part.time.start) : 0
  return (
    <Box flexDirection="column" paddingLeft={3} marginTop={1}>
      <Box onClick={() => setOpen((v) => !v)}>
        <ReasoningHeader part={part} open={open} toggleable />
        {duration > 0 ? <Text color={theme.textMuted}> · {formatDuration(duration)}</Text> : null}
      </Box>
      {open ? (
        <Box paddingLeft={2} marginTop={1}>
          <Text color={theme.textMuted}>{content}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

function TextPart({ part }: { part: Extract<Part, { type: "text" }> }) {
  const { theme } = useTheme()
  const text = part.text.trim()
  if (!text) return null
  return (
    <Box paddingLeft={3} marginTop={1} flexShrink={0}>
      <Text color={theme.markdownText}>{text}</Text>
    </Box>
  )
}

function GenericTool({ part }: { part: Extract<Part, { type: "tool" }> }) {
  const { theme } = useTheme()
  const output = getString(part.state.output)?.trim() ?? ""
  const input = part.state.input ?? {}
  return (
    <Box paddingLeft={3} marginTop={1}>
      <Text color={theme.text}>
        ⚙ {part.tool} {inputSummary(input)}
      </Text>
      {output ? (
        <Box marginTop={1}>
          <Text color={theme.text}>{output}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

function ToolPart({ part }: { part: Extract<Part, { type: "tool" }> }) {
  // Per-tool rendering is summarized inline. Detailed sub-components (Shell,
  // Edit, Write, etc.) can be reintroduced when Maximilian's TUI gains a
  // diff viewer and syntax highlighter.
  return <GenericTool part={part} />
}

function UserMessage({
  message,
  parts,
  pending,
  onClick,
}: {
  message: Message
  parts: Part[]
  pending?: string
  onClick?: () => void
}) {
  const { theme } = useTheme()
  const local = useLocal()
  const text = parts
    .map((p) => (p.type === "text" && !p.synthetic ? p.text : null))
    .filter(Boolean)
    .join("\n\n")
  const files = parts.filter((p): p is Extract<Part, { type: "file" }> => p.type === "file")
  const queued = pending && message.id > pending
  const color = local.agent.color(message.agent ?? "")
  if (!text && files.length === 0) return null
  return (
    <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor={color} paddingLeft={1}>
      <Box paddingLeft={1} paddingTop={1} paddingBottom={1} flexDirection="column">
        {text ? <Text color={theme.text}>{text}</Text> : null}
        {files.length > 0 ? (
          <Box flexDirection="row" gap={1} paddingTop={1} flexWrap="wrap">
            {files.map((file) => (
              <Text key={file.url} color={theme.textMuted}>
                [{file.mime}] {file.filename}
              </Text>
            ))}
          </Box>
        ) : null}
        {queued ? (
          <Text color={theme.warning} bold>
            QUEUED
          </Text>
        ) : (
          <Text color={theme.textMuted}>{formatTodayOrDate(message.time.created)}</Text>
        )}
        {onClick ? (
          <Box marginTop={1}>
            <Text color={theme.textMuted}>(click to view message actions)</Text>
          </Box>
        ) : null}
      </Box>
    </Box>
  )
}

function AssistantMessage({ message, parts }: { message: Message; parts: Part[]; last: boolean }) {
  const { theme } = useTheme()
  const sync = useSync()
  const messages = (sync.data.message as Record<string, Message[]>)[message.sessionID] ?? []
  const final = !!message.finish && !["tool-calls", "unknown"].includes(message.finish)
  const duration =
    final && message.time.completed
      ? (() => {
          const user = messages.find((x) => x.role === "user" && x.id === message.parentID)
          if (!user?.time) return 0
          return message.time.completed - user.time.created
        })()
      : 0
  return (
    <Box flexDirection="column">
      {parts.map((part, index) => {
        if (part.type === "text") return <TextPart key={`${part.type}-${index}`} part={part} />
        if (part.type === "reasoning") return <ReasoningPart key={`${part.type}-${index}`} part={part} />
        if (part.type === "tool") return <ToolPart key={`${part.type}-${index}`} part={part} />
        return null
      })}
      {message.error && message.error.name !== "MessageAbortedError" ? (
        <Box marginTop={1} borderStyle="single" borderColor={theme.error} paddingLeft={1}>
          <Text color={theme.error}>{message.error.data?.message ?? message.error.message}</Text>
        </Box>
      ) : null}
      {(message as { last?: boolean }).last || final || message.error?.name === "MessageAbortedError" ? (
        <Box paddingLeft={3}>
          <Text>
            <Text color={theme.primary}>▣ </Text>
            <Text color={theme.text}>{message.mode ?? ""}</Text>
            <Text color={theme.textMuted}>
              {" · "}
              {message.providerID ?? ""}/{message.modelID ?? ""}
              {duration > 0 ? ` · ${formatDuration(duration)}` : ""}
              {message.error?.name === "MessageAbortedError" ? " · interrupted" : ""}
            </Text>
          </Text>
        </Box>
      ) : null}
    </Box>
  )
}

// -- Main component ----------------------------------------------------------

export function Session() {
  const route = useRouteData("session")
  const { navigate } = useRoute()
  const sync = useSync()
  const event = useEvent()
  const sdk = useSDK()
  const local = useLocal()
  const { theme } = useTheme()
  const args = useArgs()
  void args

  const session = useMemo(
    () => (sync.data.session as Session[]).find((s) => s.id === route.sessionID),
    [sync.data.session, route.sessionID],
  )
  const messages = useMemo(
    () => ((sync.data.message as Record<string, Message[]>)[route.sessionID] ?? []) as Message[],
    [sync.data.message, route.sessionID],
  )
  const pending = useMemo(() => {
    const completed = messages.findLast((x) => x.role === "assistant" && x.time.completed)?.id
    return messages.findLast(
      (x) => x.role === "assistant" && !x.time.completed && (!completed || x.id > completed),
    )?.id
  }, [messages])
  const lastAssistant = useMemo(() => messages.findLast((x) => x.role === "assistant"), [messages])

  const [showTimestamps, setShowTimestamps] = useState(false)
  const [showDetails, setShowDetails] = useState(true)
  const [sidebarVisible, setSidebarVisible] = useState(false)

  const promptRef = useRef<PromptRef | undefined>(undefined)
  const seededRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        await sdk.client.get<{ directory: string }>(`/session/${route.sessionID}`).catch(() => null)
        await sdk.client.get<unknown[]>(`/session/${route.sessionID}/messages`).catch(() => null)
      } catch {
        if (cancelled) return
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sdk, route.sessionID])

  useEffect(() => {
    const off = event.on("message.part.updated", (evt) => {
      const part = (evt as { properties: { part: { type: string; sessionID: string; id: string; tool: string } } }).properties.part
      if (part.type !== "tool") return
      if (part.sessionID !== route.sessionID) return
      if (part.tool === "plan_exit") local.agent.set("build")
      else if (part.tool === "plan_enter") local.agent.set("plan")
    })
    return off
  }, [event, route.sessionID, local])

  const bind = (ref: PromptRef | undefined) => {
    promptRef.current = ref
    if (seededRef.current || !route.prompt || !ref) return
    seededRef.current = true
    ref.set(route.prompt as Parameters<PromptRef["set"]>[0])
  }

  // The original route dispatched commands like session.share, session.rename,
  // session.compact, etc. via a keymap layer. For Maximilian we expose them
  // through a small imperative API on a context bus so the prompt can wire
  // them later.
  const sessionCommands = useMemo(
    () => ({
      share: () => console.log("[session.share] not yet wired"),
      rename: () => console.log("[session.rename] not yet wired"),
      timeline: () => console.log("[session.timeline] not yet wired"),
      fork: () => console.log("[session.fork] not yet wired"),
      compact: async () => {
        const m = local.model.current()
        if (!m) return
        await sdk.client.post(`/session/${route.sessionID}/summarize`, { modelID: m.modelID, providerID: m.providerID })
      },
      unshare: () => console.log("[session.unshare] not yet wired"),
      toggleSidebar: () => setSidebarVisible((v) => !v),
      toggleTimestamps: () => setShowTimestamps((v) => !v),
      toggleDetails: () => setShowDetails((v) => !v),
      copyLastAssistant: () => console.log("[messages.copy] not yet wired"),
    }),
    [sdk, route.sessionID, local],
  )
  void sessionCommands

  const toBottom = () => {
    /* scrollbox would scroll here; ink does not have a virtualized list */
  }

  useEffect(() => {
    // Snap-to-bottom on session change.
    toBottom()
  }, [route.sessionID])

  if (!session) {
    return (
      <Box flexDirection="column" flexGrow={1} alignItems="center" justifyContent="center">
        <Text color={theme.textMuted}>Session not found.</Text>
      </Box>
    )
  }

  const sidebar: ReactNode = sidebarVisible ? (
    <Box flexDirection="column" width={40} borderStyle="single" borderColor={theme.border}>
      <Text color={theme.textMuted}>Sessions sidebar (stub)</Text>
    </Box>
  ) : null

  return (
    <Box flexDirection="row" flexGrow={1}>
      <Box flexDirection="column" flexGrow={1} paddingLeft={2} paddingRight={2} gap={1}>
        <Box flexDirection="column" flexGrow={1}>
          {messages.map((message, index) => {
            const parts = ((sync.data.part as Record<string, Part[]>)[message.id] ?? []) as Part[]
            if (message.role === "user") {
              return (
                <UserMessage
                  key={message.id}
                  message={message}
                  parts={parts}
                  pending={pending}
                  onClick={() => console.log("[dialog.message] not yet wired")}
                />
              )
            }
            return (
              <AssistantMessage
                key={message.id}
                message={message}
                parts={parts}
                last={lastAssistant?.id === message.id}
              />
            )
          })}
        </Box>
        <Box flexShrink={0}>
          <Prompt ref={bind} sessionID={route.sessionID} onSubmit={toBottom} />
        </Box>
      </Box>
      {sidebar}
    </Box>
  )
}