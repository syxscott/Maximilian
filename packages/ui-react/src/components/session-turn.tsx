"use client"

import * as React from "react"
import * as Accordion from "@radix-ui/react-accordion"
import { cn } from "../lib/utils.js"
import { AssistantParts, Message, MessageDivider, PART_MAPPING, type UserActions, type Part } from "./message-part.js"

interface SessionStatus {
  type: string
  attempt?: number
  message?: string
  next?: number
}

interface MessageLite {
  id: string
  role: "user" | "assistant"
  parentID?: string
  time?: { created?: number; completed?: number }
  error?: { name?: string; data?: { message?: unknown } }
  summary?: { diffs?: Array<{ file?: string; additions: number; deletions: number }> }
}

interface DataStore {
  session_status?: Record<string, SessionStatus>
  message?: Record<string, MessageLite[]>
  part?: Record<string, Part[]>
}

interface DataCtxValue {
  directory?: string
  navigateToSession?: (id: string) => void
  sessionHref?: (id: string) => string | undefined
  store: DataStore
}

const DataContext = React.createContext<DataCtxValue | null>(null)
const useData = (): DataCtxValue => {
  const ctx = React.useContext(DataContext)
  return ctx ?? { store: {} }
}

const FileContext = React.createContext<React.ComponentType<{ mode?: string; [key: string]: unknown }> | null>(null)
const useFileComponent = (): React.ComponentType<{ mode?: string; [key: string]: unknown }> => {
  return React.useContext(FileContext) ?? (() => (
    <div className="rounded border border-border-weak-base bg-background-base p-4 text-12-regular text-text-weak">
      File viewer unavailable
    </div>
  ))
}

interface I18nContextValue {
  locale: () => string
  t: (key: string, params?: Record<string, string | number | boolean>) => string
}

const FALLBACK_I18N: I18nContextValue = {
  locale: () => "en",
  t: (key) => key,
}

const I18nContext = React.createContext<I18nContextValue>(FALLBACK_I18N)
const useI18n = () => React.useContext(I18nContext)

const SessionRetry: React.FC<{ status: SessionStatus; show: boolean }> = ({ status, show }) => {
  if (!show) return null
  if (status.type !== "retry") return null
  return (
    <div data-component="session-retry" className="rounded border border-border-warning-base bg-background-base p-3 text-13-regular text-text-base">
      Retrying (attempt {status.attempt ?? 1})...
    </div>
  )
}

const TextShimmer: React.FC<{ text: string }> = ({ text }) => (
  <span data-component="text-shimmer" aria-label={text}>
    <span data-slot="text-shimmer-char">
      <span data-slot="text-shimmer-char-base" aria-hidden="true">
        {text}
      </span>
    </span>
  </span>
)

const TextReveal: React.FC<{ text?: string; className?: string; travel?: number; duration?: number }> = ({ text, className }) => {
  return (
    <span data-component="text-reveal" className={className}>
      {text}
    </span>
  )
}

const Card: React.FC<{ variant?: string; className?: string; children: React.ReactNode }> = ({ variant, className, children }) => (
  <div data-component="card" data-variant={variant} className={cn("rounded border border-border-error-base bg-background-base p-3 text-13-regular text-text-base", className)}>
    {children}
  </div>
)

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function unwrap(message: string): string {
  const text = message.replace(/^Error:\s*/, "").trim()
  const parse = (value: string) => {
    try {
      return JSON.parse(value) as unknown
    } catch {
      return undefined
    }
  }
  const read = (value: string) => {
    const first = parse(value)
    if (typeof first !== "string") return first
    return parse(first.trim())
  }
  let json = read(text)
  if (json === undefined) {
    const start = text.indexOf("{")
    const end = text.lastIndexOf("}")
    if (start !== -1 && end > start) {
      json = read(text.slice(start, end + 1))
    }
  }
  if (!record(json)) return message
  const err = record(json.error) ? json.error : undefined
  if (err) {
    const type = typeof err.type === "string" ? err.type : undefined
    const msg = typeof err.message === "string" ? err.message : undefined
    if (type && msg) return `${type}: ${msg}`
    if (msg) return msg
    if (type) return type
    const code = typeof err.code === "string" ? err.code : undefined
    if (code) return code
  }
  const msg = typeof json.message === "string" ? json.message : undefined
  if (msg) return msg
  const reason = typeof json.error === "string" ? json.error : undefined
  if (reason) return reason
  return message
}

function getFilename(path: string | undefined): string {
  if (!path) return ""
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))
  return idx >= 0 ? path.slice(idx + 1) : path
}

function getDirectory(path: string | undefined): string {
  if (!path) return ""
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))
  return idx >= 0 ? path.slice(0, idx) : ""
}

function partState(part: Part, showReasoningSummaries: boolean) {
  if (part.type === "tool") {
    const tool = (part as { tool?: string }).tool
    if (tool === "todowrite") return undefined
    if (tool === "question") {
      const status = (part as { state?: { status?: string } }).state?.status
      if (status === "pending" || status === "running") return undefined
    }
    return "visible" as const
  }
  if (part.type === "text") return (part as { text?: string }).text?.trim() ? ("visible" as const) : undefined
  if (part.type === "reasoning") {
    if (showReasoningSummaries && (part as { text?: string }).text?.trim()) return "visible" as const
    return undefined
  }
  if (PART_MAPPING[part.type]) return "visible" as const
  return undefined
}

function clean(value: string) {
  return value.replace(/`([^`]+)`/g, "$1").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*_~]+/g, "").trim()
}

function heading(text: string): string | undefined {
  const markdown = text.replace(/\r\n?/g, "\n")
  const html = markdown.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i)
  if (html?.[1]) {
    const value = clean(html[1].replace(/<[^>]+>/g, " "))
    if (value) return value
  }
  const atx = markdown.match(/^\s{0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/m)
  if (atx?.[1]) {
    const value = clean(atx[1])
    if (value) return value
  }
  const setext = markdown.match(/^([^\n]+)\n(?:=+|-+)\s*$/m)
  if (setext?.[1]) {
    const value = clean(setext[1])
    if (value) return value
  }
  const strong = markdown.match(/^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*$/m)
  if (strong?.[1]) {
    const value = clean(strong[1])
    if (value) return value
  }
  return undefined
}

const DiffChanges: React.FC<{ changes: unknown }> = ({ changes }) => (
  <span data-component="diff-changes" className="inline-flex items-center gap-1">
    {(changes as { additions?: number; deletions?: number })?.additions ?? 0}
  </span>
)

export interface SessionTurnProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  sessionID: string
  messageID: string
  messages?: MessageLite[]
  actions?: UserActions
  showReasoningSummaries?: boolean
  shellToolDefaultOpen?: boolean
  editToolDefaultOpen?: boolean
  active?: boolean
  status?: SessionStatus
  onUserInteracted?: () => void
  classes?: {
    root?: string
    content?: string
    container?: string
  }
  children?: React.ReactNode
}

const useAutoScroll = (opts: {
  working: boolean
  onUserInteracted?: () => void
  overflowAnchor: "dynamic" | "none"
}) => {
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const pausedRef = React.useRef(false)
  const [pauseToken, setPauseToken] = React.useState(0)

  React.useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const handleScroll = () => {
      if (!opts.working) return
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 4
      if (!atBottom && !pausedRef.current) {
        pausedRef.current = true
        setPauseToken((x) => x + 1)
      } else if (atBottom && pausedRef.current) {
        pausedRef.current = false
      }
    }
    el.addEventListener("scroll", handleScroll)
    return () => el.removeEventListener("scroll", handleScroll)
  }, [opts.working])

  React.useEffect(() => {
    if (!opts.working) return
    const el = scrollRef.current
    if (!el || pausedRef.current) return
    el.scrollTop = el.scrollHeight
  }, [opts.working, pauseToken])

  return {
    scrollRef,
    contentRef,
    handleScroll: () => undefined,
    handleInteraction: () => {
      opts.onUserInteracted?.()
    },
    pause: () => {
      pausedRef.current = true
      setPauseToken((x) => x + 1)
    },
  }
}

export const SessionTurn: React.FC<SessionTurnProps> = ({
  sessionID,
  messageID,
  messages,
  actions,
  showReasoningSummaries,
  shellToolDefaultOpen,
  editToolDefaultOpen,
  active: activeProp,
  status: statusProp,
  onUserInteracted,
  classes,
  children,
  className,
  ...rest
}) => {
  const data = useData()
  const i18n = useI18n()
  const fileComponent = useFileComponent()

  const allMessages = React.useMemo(() => {
    return messages ?? data.store.message?.[sessionID] ?? []
  }, [messages, data.store.message, sessionID])

  const messageIndex = React.useMemo(() => {
    const idx = allMessages.findIndex((m) => m.id === messageID)
    if (idx < 0) return -1
    const msg = allMessages[idx]
    if (!msg || msg.role !== "user") return -1
    return idx
  }, [allMessages, messageID])

  const message = messageIndex >= 0 ? allMessages[messageIndex] : undefined
  const parts = React.useMemo(() => {
    if (!message) return []
    return data.store.part?.[message.id] ?? []
  }, [data.store.part, message])

  const compaction = parts.find((part) => part.type === "compaction")

  const diffs = React.useMemo(() => {
    const files = (message?.summary?.diffs ?? []) as Array<{ file?: string; additions: number; deletions: number }>
    if (!files.length) return []
    const seen = new Set<string>()
    const result: typeof files = []
    for (let i = files.length - 1; i >= 0; i--) {
      const diff = files[i]
      if (!diff || !diff.file || seen.has(diff.file)) continue
      seen.add(diff.file)
      result.push(diff)
    }
    return result.reverse()
  }, [message?.summary?.diffs])

  const MAX_FILES = 10
  const [state, setState] = React.useState({ showAll: false, expanded: [] as string[] })
  const overflow = Math.max(0, diffs.length - MAX_FILES)
  const visible = state.showAll ? diffs : diffs.slice(0, MAX_FILES)

  const pending = React.useMemo(() => {
    if (typeof activeProp === "boolean") return undefined
    for (let i = allMessages.length - 1; i >= 0; i--) {
      const item = allMessages[i]
      if (item && item.role === "assistant" && typeof item.time?.completed !== "number") {
        return item
      }
    }
    return undefined
  }, [allMessages, activeProp])

  const pendingUser = React.useMemo(() => {
    if (!pending?.parentID) return undefined
    return allMessages.find((m) => m.id === pending.parentID && m.role === "user")
  }, [allMessages, pending])

  const active = typeof activeProp === "boolean" ? activeProp : !!(message && pendingUser && pendingUser.id === message.id)

  const assistantMessages = React.useMemo(() => {
    if (!message) return []
    const result = [] as typeof allMessages
    for (let i = 0; i < allMessages.length; i++) {
      const item = allMessages[i]
      if (item && item.role === "assistant" && item.parentID === message.id) {
        result.push(item as never)
      }
    }
    return result
  }, [allMessages, message])

  const interrupted = assistantMessages.some((m) => m.error?.name === "MessageAbortedError")
  const divider = compaction ? "Compaction" : interrupted ? i18n.t("ui.message.interrupted") : ""
  const error = assistantMessages.find((m) => m.error && m.error.name !== "MessageAbortedError")?.error

  const showAssistantCopyPartID = React.useMemo(() => {
    for (let i = assistantMessages.length - 1; i >= 0; i--) {
      const message = assistantMessages[i]
      if (!message) continue
      const list = data.store.part?.[message.id] ?? []
      for (let j = list.length - 1; j >= 0; j--) {
        const part = list[j]
        if (part && part.type === "text" && (part as { text?: string }).text?.trim()) {
          return part.id
        }
      }
    }
    return undefined
  }, [assistantMessages, data.store.part])

  const errorText = React.useMemo(() => {
    const msg = error?.data?.message
    if (typeof msg === "string") return unwrap(msg)
    if (msg === undefined || msg === null) return ""
    return unwrap(String(msg))
  }, [error])

  const status: SessionStatus = statusProp ?? (typeof activeProp === "boolean" && !activeProp ? { type: "idle" } : data.store.session_status?.[sessionID] ?? { type: "idle" })
  const working = status.type !== "idle" && active

  const turnDurationMs = React.useMemo(() => {
    const start = message?.time?.created
    if (typeof start !== "number") return undefined
    let end: number | undefined
    for (const m of assistantMessages) {
      const completed = m.time?.completed
      if (typeof completed === "number") {
        end = end === undefined ? completed : Math.max(end, completed)
      }
    }
    if (typeof end !== "number" || end < start) return undefined
    return end - start
  }, [message, assistantMessages])

  const assistantDerived = React.useMemo(() => {
    let visibleCount = 0
    let reason: string | undefined
    const show = showReasoningSummaries ?? true
    for (const message of assistantMessages) {
      const list = data.store.part?.[message.id] ?? []
      for (const part of list) {
        if (partState(part, show) === "visible") visibleCount++
        if (part.type === "reasoning") {
          const text = (part as { text?: string }).text
          if (text) {
            const h = heading(text)
            if (h) reason = h
          }
        }
      }
    }
    return { visible: visibleCount, reason }
  }, [assistantMessages, data.store.part, showReasoningSummaries])

  const assistantVisible = assistantDerived.visible
  const reasoningHeading = assistantDerived.reason
  const showThinking =
    working &&
    !error &&
    status.type !== "retry" &&
    ((showReasoningSummaries ?? true) ? assistantVisible === 0 : true)

  const autoScroll = useAutoScroll({
    working,
    onUserInteracted,
    overflowAnchor: "dynamic",
  })

  const renderDiff = (diff: { file?: string; additions: number; deletions: number }, index: number) => {
    if (!diff.file) return null
    const isOpen = state.expanded.includes(diff.file)
    return (
      <Accordion.Item key={diff.file} value={diff.file} className="border-b border-border-weak-base">
        <Accordion.Header>
          <Accordion.Trigger className="flex w-full items-center justify-between gap-2 px-4 py-2">
            <div data-slot="session-turn-diff-trigger" className="flex w-full items-center justify-between">
              <span data-slot="session-turn-diff-path" className="truncate">
                {diff.file.includes("/") && (
                  <span data-slot="session-turn-diff-directory">{getDirectory(diff.file)}/</span>
                )}
                <span data-slot="session-turn-diff-filename">{getFilename(diff.file)}</span>
              </span>
              <div data-slot="session-turn-diff-meta" className="flex items-center gap-2">
                <span data-slot="session-turn-diff-changes">
                  <DiffChanges changes={diff} />
                </span>
              </div>
            </div>
          </Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Content>
          {isOpen && (
            <div data-slot="session-turn-diff-view" data-scrollable className="p-2">
              {React.createElement(fileComponent, { mode: "diff", fileDiff: { file: diff.file, additions: diff.additions, deletions: diff.deletions } })}
            </div>
          )}
        </Accordion.Content>
      </Accordion.Item>
    )
  }

  return (
    <div data-component="session-turn" className={cn(classes?.root, className)} {...rest}>
      <div
        ref={autoScroll.scrollRef}
        onScroll={autoScroll.handleScroll}
        data-slot="session-turn-content"
        className={cn(classes?.content)}
      >
        <div onClick={autoScroll.handleInteraction}>
          {message && (
            <div
              ref={autoScroll.contentRef}
              data-message={message.id}
              data-slot="session-turn-message-container"
              className={cn(classes?.container)}
            >
              <div data-slot="session-turn-message-content" aria-live="off">
                <Message message={message as never} parts={parts as never} actions={actions} />
              </div>
              {divider && (
                <div data-slot="session-turn-compaction">
                  <MessageDivider label={divider} />
                </div>
              )}
              {assistantMessages.length > 0 && (
                <div data-slot="session-turn-assistant-content" aria-hidden={working}>
                  <AssistantParts
                    messages={assistantMessages as never}
                    showAssistantCopyPartID={working ? null : showAssistantCopyPartID ?? null}
                    turnDurationMs={turnDurationMs}
                    working={working}
                    showReasoningSummaries={showReasoningSummaries}
                    shellToolDefaultOpen={shellToolDefaultOpen}
                    editToolDefaultOpen={editToolDefaultOpen}
                  />
                </div>
              )}
              {showThinking && (
                <div data-slot="session-turn-thinking" className="flex items-center gap-2">
                  <TextShimmer text={"Thinking..."} />
                  {!(showReasoningSummaries ?? true) && (
                    <TextReveal text={reasoningHeading} className="session-turn-thinking-heading" />
                  )}
                </div>
              )}
              <SessionRetry status={status} show={active} />
              {diffs.length > 0 && !working && (
                <div data-slot="session-turn-diffs" data-component="session-turn-diffs-group" data-show-all={state.showAll || undefined}>
                  <div data-slot="session-turn-diffs-header" className="flex items-center justify-between gap-2">
                    <span data-slot="session-turn-diffs-label">
                      {diffs.length} changed {diffs.length === 1 ? "file" : "files"}
                    </span>
                    <DiffChanges changes={diffs} />
                    {overflow > 0 && (
                      <span
                        data-slot="session-turn-diffs-toggle"
                        onClick={() => setState((s) => ({ ...s, showAll: !s.showAll }))}
                        className="cursor-pointer text-12-medium text-text-base"
                      >
                        {state.showAll ? "Show less" : "Show all"}
                      </span>
                    )}
                  </div>
                  <div data-component="session-turn-diffs-content">
                    <Accordion.Root
                      type="multiple"
                      value={state.expanded}
                      onValueChange={(value) => setState((s) => ({ ...s, expanded: Array.isArray(value) ? value : value ? [value] : [] }))}
                      style={{ ["--sticky-accordion-offset" as string]: "44px" }}
                    >
                      {visible.map(renderDiff)}
                    </Accordion.Root>
                    {!state.showAll && overflow > 0 && (
                      <div
                        data-slot="session-turn-diffs-more"
                        onClick={() => setState((s) => ({ ...s, showAll: true }))}
                        className="cursor-pointer p-2 text-center text-12-medium text-text-base"
                      >
                        {overflow} more
                      </div>
                    )}
                  </div>
                </div>
              )}
              {error && (
                <Card variant="error" className="error-card mt-2">
                  {errorText}
                </Card>
              )}
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  )
}

export interface SessionTurnContextValue extends DataCtxValue {
  i18n?: { t: (key: string, params?: Record<string, string | number | boolean>) => string; locale?: () => string }
  fileComponent?: React.ComponentType<{ mode?: string; [key: string]: unknown }>
}

export const SessionTurnProvider: React.FC<{
  data?: DataCtxValue
  i18n?: { t: (key: string, params?: Record<string, string | number | boolean>) => string; locale?: () => string }
  fileComponent?: React.ComponentType<{ mode?: string; [key: string]: unknown }>
  children: React.ReactNode
}> = ({ data, i18n, fileComponent, children }) => {
  const i18nCtx: I18nContextValue = React.useMemo(() => {
    if (!i18n) return FALLBACK_I18N
    return {
      t: i18n.t,
      locale: i18n.locale ?? (() => "en"),
    }
  }, [i18n])
  return (
    <I18nContext.Provider value={i18nCtx}>
      <DataContext.Provider value={data ?? { store: {} }}>
        <FileContext.Provider value={fileComponent ?? null}>{children}</FileContext.Provider>
      </DataContext.Provider>
    </I18nContext.Provider>
  )
}