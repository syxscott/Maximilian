"use client"

import * as React from "react"
import * as Accordion from "@radix-ui/react-accordion"
import * as Checkbox from "@radix-ui/react-checkbox"
import * as Collapsible from "@radix-ui/react-collapsible"
import * as Tooltip from "@radix-ui/react-tooltip"
import { cn } from "../lib/utils.js"
import { BasicTool, GenericTool, type TriggerTitle, type IconName } from "./basic-tool.js"
import { AnimatedCountList, type CountItem } from "./tool-count-summary.js"
import { ToolStatusTitle } from "./tool-status-title.js"
import { ToolErrorCard } from "./tool-error-card.js"

// -----------------------------------------------------------------------------
// Domain types (kept loose so the host can plug in its own SDK)
// -----------------------------------------------------------------------------

export interface ToolPart {
  id: string
  type: "tool"
  tool: string
  sessionID?: string
  state: {
    status?: string
    input?: Record<string, unknown>
    metadata?: Record<string, unknown>
    output?: unknown
    error?: string
    title?: string
  }
}

export interface TextPart {
  id: string
  type: "text"
  text?: string
  synthetic?: boolean
  source?: { text?: { start?: number; end?: number } }
}

export interface ReasoningPart {
  id: string
  type: "reasoning"
  text?: string
}

export interface FilePart {
  id: string
  type: "file"
  filename?: string
  url?: string
  source?: { text?: { start?: number; end?: number } }
}

export interface AgentPart {
  id: string
  type: "agent"
  name?: string
  source?: { start?: number; end?: number }
}

export interface CompactionPart {
  id: string
  type: "compaction"
}

export interface QuestionAnswer {
  question?: string
  answer?: string
  // Allow extra answer slots; in the original SolidJS code answers could be an array
  [key: string]: unknown
}

export interface QuestionInfo {
  question: string
  options?: Array<{ label: string; description?: string }>
}

export interface Todo {
  content: string
  status: "pending" | "completed" | "in_progress"
  priority?: "low" | "medium" | "high"
}

export interface UserMessage {
  id: string
  role: "user"
  sessionID: string
  agent?: string
  model?: { providerID?: string; modelID?: string }
  time?: { created?: number }
  summary?: { title?: string; diffs?: unknown[] }
}

export interface AssistantMessage {
  id: string
  role: "assistant"
  parentID: string
  providerID: string
  modelID: string
  agent?: string
  error?: { name?: string; data?: { message?: unknown } }
  time?: { created?: number; completed?: number }
}

export type Message = UserMessage | AssistantMessage
export type Part = ToolPart | TextPart | ReasoningPart | FilePart | AgentPart | CompactionPart | { id: string; type: string; [key: string]: unknown }

export type SessionAction = (input: { sessionID: string; messageID: string }) => Promise<void> | void

export type UserActions = {
  fork?: SessionAction
  revert?: SessionAction
}

// -----------------------------------------------------------------------------
// Stub i18n
// -----------------------------------------------------------------------------

type TKey =
  | "ui.messagePart.diagnostic.error"
  | "ui.messagePart.compaction"
  | "ui.messagePart.questions.dismissed"
  | "ui.messagePart.title.edit"
  | "ui.messagePart.title.write"
  | "ui.messagePart.context.read.one"
  | "ui.messagePart.context.read.other"
  | "ui.messagePart.context.search.one"
  | "ui.messagePart.context.search.other"
  | "ui.messagePart.context.list.one"
  | "ui.messagePart.context.list.other"
  | "ui.tool.agent.default"
  | "ui.tool.agent"
  | "ui.tool.read"
  | "ui.tool.list"
  | "ui.tool.glob"
  | "ui.tool.grep"
  | "ui.tool.webfetch"
  | "ui.tool.shell"
  | "ui.tool.patch"
  | "ui.tool.todos"
  | "ui.tool.questions"
  | "ui.tool.skill"
  | "ui.message.copied"
  | "ui.message.copyMessage"
  | "ui.message.copyResponse"
  | "ui.message.copy"
  | "ui.message.revertMessage"
  | "ui.message.attachment.alt"
  | "ui.message.interrupted"
  | "ui.sessionTurn.status.gatheringContext"
  | "ui.sessionTurn.status.gatheredContext"
  | "ui.common.file.one"
  | "ui.common.file.other"
  | "ui.common.question.one"
  | "ui.common.question.other"
  | "ui.patch.action.created"
  | "ui.patch.action.deleted"
  | "ui.patch.action.moved"
  | "ui.message.duration.seconds"
  | "ui.message.duration.minutesSeconds"
  | "ui.question.subtitle.answered"
  | "ui.question.answer.none"
  | "ui.basicTool.called"

const FALLBACK: Record<TKey, string> = {
  "ui.messagePart.diagnostic.error": "Error",
  "ui.messagePart.compaction": "Compaction",
  "ui.messagePart.questions.dismissed": "Question dismissed",
  "ui.messagePart.title.edit": "Edit",
  "ui.messagePart.title.write": "Write",
  "ui.messagePart.context.read.one": "{{count}} file read",
  "ui.messagePart.context.read.other": "{{count}} files read",
  "ui.messagePart.context.search.one": "{{count}} search",
  "ui.messagePart.context.search.other": "{{count}} searches",
  "ui.messagePart.context.list.one": "{{count}} list",
  "ui.messagePart.context.list.other": "{{count}} lists",
  "ui.tool.agent.default": "Agent",
  "ui.tool.agent": "Agent ({{type}})",
  "ui.tool.read": "Read",
  "ui.tool.list": "List",
  "ui.tool.glob": "Glob",
  "ui.tool.grep": "Grep",
  "ui.tool.webfetch": "Web Fetch",
  "ui.tool.shell": "Shell",
  "ui.tool.patch": "Patch",
  "ui.tool.todos": "Todos",
  "ui.tool.questions": "Questions",
  "ui.tool.skill": "Skill",
  "ui.message.copied": "Copied",
  "ui.message.copyMessage": "Copy message",
  "ui.message.copyResponse": "Copy response",
  "ui.message.copy": "Copy",
  "ui.message.revertMessage": "Revert message",
  "ui.message.attachment.alt": "Attachment",
  "ui.message.interrupted": "Interrupted",
  "ui.sessionTurn.status.gatheringContext": "Gathering context",
  "ui.sessionTurn.status.gatheredContext": "Gathered context",
  "ui.common.file.one": "file",
  "ui.common.file.other": "files",
  "ui.common.question.one": "question",
  "ui.common.question.other": "questions",
  "ui.patch.action.created": "Created",
  "ui.patch.action.deleted": "Deleted",
  "ui.patch.action.moved": "Moved",
  "ui.message.duration.seconds": "{{count}}s",
  "ui.message.duration.minutesSeconds": "{{minutes}}m {{seconds}}s",
  "ui.question.subtitle.answered": "{{count}} answered",
  "ui.question.answer.none": "No answer",
  "ui.basicTool.called": "Called {{tool}}",
}

const I18nContext = React.createContext<{
  locale: () => string
  t: (key: TKey | string, params?: Record<string, string | number | boolean>) => string
}>({
  locale: () => "en",
  t: (key, params) => {
    const value = (FALLBACK as Record<string, string>)[key as string] ?? String(key)
    if (!params) return value
    return value.replace(/{{\s*([^}]+?)\s*}}/g, (_, raw) => {
      const v = params[String(raw)]
      return v === undefined ? "" : String(v)
    })
  },
})

const useI18n = () => React.useContext(I18nContext)

interface I18nProviderProps {
  value?: {
    locale?: () => string
    t: (key: string, params?: Record<string, string | number | boolean>) => string
  }
  children: React.ReactNode
}

export const I18nProvider: React.FC<I18nProviderProps> = ({ value, children }) => {
  const ctx = React.useMemo(() => {
    if (!value) {
      return {
        locale: () => "en",
        t: (key: TKey | string, params?: Record<string, string | number | boolean>) => {
          const v = (FALLBACK as Record<string, string>)[key as string] ?? String(key)
          if (!params) return v
          return v.replace(/{{\s*([^}]+?)\s*}}/g, (_, raw) => {
            const x = params[String(raw)]
            return x === undefined ? "" : String(x)
          })
        },
      }
    }
    return {
      locale: value.locale ?? (() => "en"),
      t: (key: TKey | string, params?: Record<string, string | number | boolean>) => {
        const v = (FALLBACK as Record<string, string>)[key as string] ?? value.t(key, params)
        if (!params) return v
        return v.replace(/{{\s*([^}]+?)\s*}}/g, (_, raw) => {
          const x = params[String(raw)]
          return x === undefined ? "" : String(x)
        })
      },
    }
  }, [value])
  return <I18nContext.Provider value={ctx}>{children}</I18nContext.Provider>
}

// -----------------------------------------------------------------------------
// Stub contexts for data, file, dialog
// -----------------------------------------------------------------------------

interface DataStore {
  agent?: { name: string; color?: string }[]
  provider?: { all?: Map<string, { models?: Record<string, { name?: string }> }> }
  session?: { id: string; parentID?: string; title: string; time: { created?: number; archived?: number } }[]
  session_status?: Record<string, { type: string }>
  part?: Record<string, Part[]>
  part_text_accum_delta?: Record<string, string>
  message?: Record<string, Message[]>
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
  if (ctx) return ctx
  return { store: {} }
}

interface DialogApi {
  show: (render: () => React.ReactNode) => void
}

const DialogContext = React.createContext<DialogApi | null>(null)
const useDialog = (): DialogApi => {
  const ctx = React.useContext(DialogContext)
  return ctx ?? { show: () => undefined }
}

const FileContext = React.createContext<React.ComponentType<{ mode?: string; [key: string]: unknown }> | null>(null)
const useFileComponent = (): React.ComponentType<{ mode?: string; [key: string]: unknown }> => {
  return React.useContext(FileContext) ?? ((props: { mode?: string; [key: string]: unknown }) => (
    <div data-component="file-fallback" data-mode={props.mode} className="rounded border border-border-weak-base bg-background-base p-4 text-12-regular text-text-weak">
      File viewer unavailable
    </div>
  ))
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

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

function relativizeProjectPath(path: string, directory?: string) {
  if (!path) return ""
  if (!directory) return path
  if (directory === "/") return path
  if (directory === "\\") return path
  if (path === directory) return ""
  const separator = directory.includes("\\") ? "\\" : "/"
  const prefix = directory.endsWith(separator) ? directory : directory + separator
  if (!path.startsWith(prefix)) return path
  return path.slice(directory.length)
}

function attached(_file: FilePart): boolean {
  return true
}
function inline(file: FilePart): boolean {
  return false
}
function kind(file: FilePart): "image" | "file" {
  if (!file.filename) return "file"
  return /\.(png|jpe?g|gif|webp|avif|bmp|ico|heic|heif|svg)$/i.test(file.filename) ? "image" : "file"
}

async function writeClipboard(text: string): Promise<boolean> {
  if (typeof document === "undefined") return false
  const body = document.body
  if (body) {
    const textarea = document.createElement("textarea")
    textarea.value = text
    textarea.setAttribute("readonly", "")
    textarea.style.position = "fixed"
    textarea.style.opacity = "0"
    textarea.style.pointerEvents = "none"
    body.appendChild(textarea)
    textarea.select()
    const copied = document.execCommand("copy")
    body.removeChild(textarea)
    if (copied) return true
  }
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      return false
    }
  }
  return false
}

// -----------------------------------------------------------------------------
// Tool icon mapping
// -----------------------------------------------------------------------------

function webSearchProviderLabel(provider: unknown): string {
  if (provider === "parallel") return "Parallel Web Search"
  if (provider === "exa") return "Exa Web Search"
  return "Web Search"
}

const agentTones: Record<string, string> = {
  ask: "var(--icon-agent-ask-base)",
  build: "var(--icon-agent-build-base)",
  docs: "var(--icon-agent-docs-base)",
  plan: "var(--icon-agent-plan-base)",
}
const agentPalette = [
  "var(--icon-agent-ask-base)",
  "var(--icon-agent-build-base)",
  "var(--icon-agent-docs-base)",
  "var(--icon-agent-plan-base)",
  "var(--syntax-info)",
  "var(--syntax-success)",
  "var(--syntax-warning)",
  "var(--syntax-property)",
  "var(--syntax-constant)",
  "var(--text-diff-add-base)",
  "var(--text-diff-delete-base)",
  "var(--icon-warning-base)",
]
function tone(name: string): string {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return agentPalette[hash % agentPalette.length]
}
function taskAgent(raw: unknown): { name?: string; color?: string } {
  if (typeof raw !== "string" || !raw) return {}
  const key = raw.toLowerCase()
  return {
    name: `${raw[0]!.toUpperCase()}${raw.slice(1)}`,
    color: agentTones[key] ?? tone(key),
  }
}

interface ToolInfo {
  icon: IconName
  title: string
  subtitle?: string
}

function getToolInfo(tool: string, input: Record<string, unknown> = {}, metadata?: Record<string, unknown>): ToolInfo {
  const t = useI18n().t
  switch (tool) {
    case "read":
      return { icon: "glasses", title: t("ui.tool.read"), subtitle: input.filePath ? getFilename(String(input.filePath)) : undefined }
    case "list":
      return { icon: "bullet-list", title: t("ui.tool.list"), subtitle: input.path ? getFilename(String(input.path)) : undefined }
    case "glob":
      return { icon: "magnifying-glass-menu", title: t("ui.tool.glob"), subtitle: input.pattern as string }
    case "grep":
      return { icon: "magnifying-glass-menu", title: t("ui.tool.grep"), subtitle: input.pattern as string }
    case "webfetch":
      return { icon: "window-cursor", title: t("ui.tool.webfetch"), subtitle: input.url as string }
    case "websearch":
      return { icon: "window-cursor", title: webSearchProviderLabel(metadata?.provider), subtitle: input.query as string }
    case "task": {
      const type = typeof input.subagent_type === "string" && input.subagent_type
        ? input.subagent_type[0]!.toUpperCase() + (input.subagent_type as string).slice(1)
        : undefined
      return { icon: "task", title: type ? t("ui.tool.agent", { type }) : t("ui.tool.agent.default"), subtitle: input.description as string }
    }
    case "bash":
      return { icon: "console", title: t("ui.tool.shell"), subtitle: input.description as string }
    case "edit":
      return { icon: "code-lines", title: t("ui.messagePart.title.edit"), subtitle: input.filePath ? getFilename(String(input.filePath)) : undefined }
    case "write":
      return { icon: "code-lines", title: t("ui.messagePart.title.write"), subtitle: input.filePath ? getFilename(String(input.filePath)) : undefined }
    case "apply_patch": {
      const files = (input.files as unknown[] | undefined)?.length ?? 0
      return {
        icon: "code-lines",
        title: t("ui.tool.patch"),
        subtitle: files ? `${files} ${t(files > 1 ? "ui.common.file.other" : "ui.common.file.one")}` : undefined,
      }
    }
    case "todowrite":
      return { icon: "checklist", title: t("ui.tool.todos") }
    case "question":
      return { icon: "bubble-5", title: t("ui.tool.questions") }
    case "skill":
      return { icon: "brain", title: (input.name as string) || t("ui.tool.skill") }
    default:
      return { icon: "mcp", title: tool }
  }
}

// -----------------------------------------------------------------------------
// Tool registry (React-flavored)
// -----------------------------------------------------------------------------

export interface ToolProps {
  input: Record<string, unknown>
  metadata: Record<string, unknown>
  tool: string
  sessionID?: string
  output?: unknown
  status?: string
  hideDetails?: boolean
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  deferContent?: boolean
  virtualizeDiff?: boolean
  onContentRendered?: () => void
  forceOpen?: boolean
  locked?: boolean
}

export type ToolRenderer = (props: ToolProps) => React.ReactNode

const toolRegistry: Record<string, ToolRenderer> = {}

export const ToolRegistry = {
  register: (name: string, render: ToolRenderer) => {
    toolRegistry[name] = render
  },
  render: (name: string): ToolRenderer | undefined => toolRegistry[name],
}

function getTool(name: string): ToolRenderer | undefined {
  return toolRegistry[name]
}

// -----------------------------------------------------------------------------
// HighlightedText, DiagnosticsDisplay
// -----------------------------------------------------------------------------

type HighlightSegment = { text: string; type?: "file" | "agent" }

const HighlightedText: React.FC<{ text: string; references: FilePart[]; agents: AgentPart[] }> = ({ text, references, agents }) => {
  const segments = React.useMemo<HighlightSegment[]>(() => {
    const allRefs: { start: number; end: number; type: "file" | "agent" }[] = [
      ...references
        .filter((r) => r.source?.text?.start !== undefined && r.source?.text?.end !== undefined)
        .map((r) => ({ start: r.source!.text!.start!, end: r.source!.text!.end!, type: "file" as const })),
      ...agents
        .filter((a) => a.source?.start !== undefined && a.source?.end !== undefined)
        .map((a) => ({ start: a.source!.start!, end: a.source!.end!, type: "agent" as const })),
    ].sort((a, b) => a.start - b.start)

    const result: HighlightSegment[] = []
    let lastIndex = 0
    for (const ref of allRefs) {
      if (ref.start < lastIndex) continue
      if (ref.start > lastIndex) {
        result.push({ text: text.slice(lastIndex, ref.start) })
      }
      result.push({ text: text.slice(ref.start, ref.end), type: ref.type })
      lastIndex = ref.end
    }
    if (lastIndex < text.length) {
      result.push({ text: text.slice(lastIndex) })
    }
    return result
  }, [text, references, agents])

  return (
    <>
      {segments.map((segment, i) => (
        <span key={i} data-highlight={segment.type}>
          {segment.text}
        </span>
      ))}
    </>
  )
}

interface Diagnostic {
  range: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
  message: string
  severity?: number
}

const DiagnosticsDisplay: React.FC<{ diagnostics: Diagnostic[] }> = ({ diagnostics }) => {
  const i18n = useI18n()
  if (diagnostics.length === 0) return null
  return (
    <div data-component="diagnostics">
      {diagnostics.map((d, i) => (
        <div key={i} data-slot="diagnostic">
          <span data-slot="diagnostic-label">{i18n.t("ui.messagePart.diagnostic.error")}</span>
          <span data-slot="diagnostic-location">
            [{d.range.start.line + 1}:{d.range.start.character + 1}]
          </span>
          <span data-slot="diagnostic-message">{d.message}</span>
        </div>
      ))}
    </div>
  )
}

function getDiagnostics(diagnosticsByFile: Record<string, Diagnostic[]> | undefined, filePath: string | undefined): Diagnostic[] {
  if (!diagnosticsByFile || !filePath) return []
  return (diagnosticsByFile[filePath] ?? []).filter((d) => d.severity === 1).slice(0, 3)
}

// -----------------------------------------------------------------------------
// Paced markdown
// -----------------------------------------------------------------------------

const TEXT_RENDER_PACE_MS = 24
const TEXT_RENDER_IMMEDIATE = 512
const TEXT_RENDER_SNAP = /[\s.,!?;:)\]]/

function step(size: number) {
  if (size <= 12) return 2
  if (size <= 48) return 4
  if (size <= 96) return 8
  return Math.min(256, Math.ceil(size / 4))
}
function nextChar(text: string, start: number) {
  const end = Math.min(text.length, start + step(text.length - start))
  const max = Math.min(text.length, end + 8)
  for (let i = end; i < max; i++) {
    if (TEXT_RENDER_SNAP.test(text[i] ?? "")) return i + 1
  }
  return end
}

function usePacedValue(value: string, live: boolean) {
  const [paced, setPaced] = React.useState(value)
  const shownRef = React.useRef(value)
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  React.useEffect(() => {
    if (!live) {
      shownRef.current = value
      setPaced(value)
      return
    }
    if (!value.startsWith(shownRef.current) || value.length <= shownRef.current.length) {
      shownRef.current = value
      setPaced(value)
      return
    }
    if (value.length - shownRef.current.length <= TEXT_RENDER_IMMEDIATE) {
      shownRef.current = value
      setPaced(value)
      return
    }
    const end = nextChar(value, shownRef.current.length)
    const next = value.slice(0, end)
    shownRef.current = next
    setPaced(next)
    if (end < value.length) {
      timeoutRef.current = setTimeout(() => {
        // re-run effect
        shownRef.current = next
        setPaced(next)
      }, TEXT_RENDER_PACE_MS)
    }
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [value, live])

  return paced
}

// -----------------------------------------------------------------------------
// ShellSubmessage
// -----------------------------------------------------------------------------

const ShellSubmessage: React.FC<{ text: string; animate?: boolean }> = ({ text, animate }) => {
  const widthRef = React.useRef<HTMLSpanElement | null>(null)
  const valueRef = React.useRef<HTMLSpanElement | null>(null)

  React.useEffect(() => {
    if (!animate) return
    const raf = requestAnimationFrame(() => {
      if (widthRef.current) {
        widthRef.current.style.width = "auto"
        widthRef.current.style.transition = "width 0.25s cubic-bezier(0.16, 1, 0.3, 1)"
      }
      if (valueRef.current) {
        valueRef.current.style.opacity = "1"
        valueRef.current.style.filter = "blur(0px)"
        valueRef.current.style.transition = "opacity 0.32s cubic-bezier(0.16, 1, 0.3, 1), filter 0.32s cubic-bezier(0.16, 1, 0.3, 1)"
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [animate])

  return (
    <span data-component="shell-submessage">
      <span
        ref={widthRef}
        data-slot="shell-submessage-width"
        style={{ width: animate ? "0px" : undefined, overflow: "hidden", display: "inline-block" }}
      >
        <span data-slot="basic-tool-tool-subtitle">
          <span
            ref={valueRef}
            data-slot="shell-submessage-value"
            style={animate ? { opacity: 0, filter: "blur(2px)" } : undefined}
          >
            {text}
          </span>
        </span>
      </span>
    </span>
  )
}

// -----------------------------------------------------------------------------
// TextShimmer placeholder
// -----------------------------------------------------------------------------

const TextShimmer: React.FC<{ text: string; active?: boolean }> = ({ text, active = true }) => {
  return (
    <span data-component="text-shimmer" data-active={active ? "true" : "false"} aria-label={text}>
      <span data-slot="text-shimmer-char">
        <span data-slot="text-shimmer-char-base" aria-hidden="true">
          {text}
        </span>
      </span>
    </span>
  )
}

// -----------------------------------------------------------------------------
// IconButton / Spinner / Markdown / FileIcon / AccordionItem
// -----------------------------------------------------------------------------

const IconButton: React.FC<{
  icon: IconName
  size?: "small" | "normal"
  variant?: "ghost" | "secondary"
  onClick?: React.MouseEventHandler
  onMouseDown?: React.MouseEventHandler
  disabled?: boolean
  "aria-label"?: string
  className?: string
  children?: React.ReactNode
}> = ({ icon, size = "normal", variant = "ghost", onClick, onMouseDown, disabled, className, children, ...rest }) => {
  return (
    <button
      type="button"
      data-component="icon-button"
      data-icon={icon}
      data-size={size}
      data-variant={variant}
      onClick={onClick}
      onMouseDown={onMouseDown}
      disabled={disabled}
      aria-label={rest["aria-label"]}
      className={cn("inline-flex items-center justify-center rounded p-1 hover:bg-background-stronger disabled:opacity-50", className)}
    >
      <IconPlaceholder name={icon} />
      {children}
    </button>
  )
}

const IconPlaceholder: React.FC<{ name: IconName; size?: "small" | "normal" }> = ({ name, size = "normal" }) => (
  <span data-slot="icon" data-icon={name} data-size={size} className="inline-block">
    <svg width={size === "small" ? 12 : 16} height={size === "small" ? 12 : 16} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6" fill="currentColor" opacity="0.2" />
    </svg>
  </span>
)

const Spinner: React.FC = () => (
  <span data-component="spinner" className="inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
)

const Markdown: React.FC<{ text: string; cacheKey?: string; streaming?: boolean }> = ({ text }) => (
  <div data-component="markdown" className="prose prose-sm max-w-none text-text-base">
    <pre className="whitespace-pre-wrap text-13-regular text-text-base">{text}</pre>
  </div>
)

const FileIcon: React.FC<{ node?: { path?: string; type?: string } }> = ({ node }) => (
  <span data-slot="file-icon" data-name={node?.path?.split(".").pop()} className="inline-block h-4 w-4 rounded bg-background-stronger" />
)

const ImagePreview: React.FC<{ src: string; alt?: string }> = ({ src, alt }) => (
  <div data-component="image-preview" className="flex items-center justify-center p-4">
    <img src={src} alt={alt} className="max-h-[80vh] max-w-full rounded" />
  </div>
)

const TooltipWrapper: React.FC<{
  value: string
  children: React.ReactNode
  placement?: "top" | "bottom" | "left" | "right"
  gutter?: number
}> = ({ value, children, placement = "top", gutter = 4 }) => {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side={placement} sideOffset={gutter} className="rounded bg-background-stronger px-2 py-1 text-12-regular text-text-base shadow-md">
          {value}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

// -----------------------------------------------------------------------------
// Part registry
// -----------------------------------------------------------------------------

export type PartComponent = (props: MessagePartProps) => React.ReactNode

const PART_MAPPING: Record<string, PartComponent | undefined> = {}

export function registerPartComponent(type: string, component: PartComponent) {
  PART_MAPPING[type] = component
}

// -----------------------------------------------------------------------------
// MessageProps / PartProps
// -----------------------------------------------------------------------------

export interface MessageProps {
  message: Message
  parts: Part[]
  actions?: UserActions
  showAssistantCopyPartID?: string | null
  showReasoningSummaries?: boolean
}

export interface MessagePartProps {
  part: Part
  message: Message
  hideDetails?: boolean
  defaultOpen?: boolean
  toolOpen?: boolean
  onToolOpenChange?: (open: boolean) => void
  deferToolContent?: boolean
  virtualizeDiff?: boolean
  onContentRendered?: () => void
  showAssistantCopyPartID?: string | null
  turnDurationMs?: number
}

const PartDisplay: React.FC<MessagePartProps> = (props) => {
  const Comp = PART_MAPPING[props.part.type]
  if (!Comp) return null
  return <Comp {...props} />
}

// -----------------------------------------------------------------------------
// ContextToolGroup
// -----------------------------------------------------------------------------

const CONTEXT_GROUP_TOOLS = new Set(["read", "glob", "grep", "list"])
const HIDDEN_TOOLS = new Set(["todowrite"])

function isContextGroupTool(part: Part): part is ToolPart {
  return part.type === "tool" && CONTEXT_GROUP_TOOLS.has((part as ToolPart).tool)
}

function renderable(part: Part, showReasoningSummaries = true): boolean {
  if (part.type === "tool") {
    if (HIDDEN_TOOLS.has((part as ToolPart).tool)) return false
    if ((part as ToolPart).tool === "question") return (part as ToolPart).state.status !== "pending" && (part as ToolPart).state.status !== "running"
    return true
  }
  if (part.type === "text") return !!(part as TextPart).text?.trim()
  if (part.type === "reasoning") return showReasoningSummaries && !!(part as ReasoningPart).text?.trim()
  return !!PART_MAPPING[part.type]
}

const ContextToolGroup: React.FC<{ parts: ToolPart[]; busy?: boolean }> = ({ parts, busy }) => {
  const i18n = useI18n()
  const [open, setOpen] = React.useState(false)
  const pending = !!busy || parts.some((p) => p.state.status === "pending" || p.state.status === "running")
  const summary = React.useMemo(() => {
    const read = parts.filter((p) => p.tool === "read").length
    const search = parts.filter((p) => p.tool === "glob" || p.tool === "grep").length
    const list = parts.filter((p) => p.tool === "list").length
    return { read, search, list }
  }, [parts])

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="tool-collapsible" data-timeline-part-ids={parts.map((p) => p.id).join(",")}>
      <Collapsible.Trigger asChild>
        <div data-component="context-tool-group-trigger" className="cursor-pointer">
          <span data-slot="context-tool-group-title" className="min-w-0 flex items-center gap-2 text-14-medium text-text-strong">
            <span data-slot="context-tool-group-label" className="shrink-0">
              <ToolStatusTitle
                active={pending}
                activeText={i18n.t("ui.sessionTurn.status.gatheringContext")}
                doneText={i18n.t("ui.sessionTurn.status.gatheredContext")}
                split={false}
              />
            </span>
            <span
              data-slot="context-tool-group-summary"
              className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-normal text-text-base"
            >
              <AnimatedCountList
                items={[
                  { key: "read", count: summary.read, one: i18n.t("ui.messagePart.context.read.one"), other: i18n.t("ui.messagePart.context.read.other") },
                  { key: "search", count: summary.search, one: i18n.t("ui.messagePart.context.search.one"), other: i18n.t("ui.messagePart.context.search.other") },
                  { key: "list", count: summary.list, one: i18n.t("ui.messagePart.context.list.one"), other: i18n.t("ui.messagePart.context.list.other") },
                ]}
                fallback=""
              />
            </span>
          </span>
          <span data-slot="collapsible-arrow" className="ml-2">▾</span>
        </div>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <div data-component="context-tool-group-list">
          {parts.map((part) => {
            const info = getToolInfo(part.tool, part.state.input ?? {}, "metadata" in part.state ? part.state.metadata : undefined)
            const running = part.state.status === "pending" || part.state.status === "running"
            return (
              <div key={part.id} data-slot="context-tool-group-item">
                <div data-component="tool-trigger">
                  <div data-slot="basic-tool-tool-trigger-content">
                    <div data-slot="basic-tool-tool-info">
                      <div data-slot="basic-tool-tool-info-structured">
                        <div data-slot="basic-tool-tool-info-main">
                          <span data-slot="basic-tool-tool-title">
                            <TextShimmer text={info.title} active={running} />
                          </span>
                          {!running && info.subtitle && (
                            <span data-slot="basic-tool-tool-subtitle">{info.subtitle}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  )
}

// -----------------------------------------------------------------------------
// Group parts
// -----------------------------------------------------------------------------

type PartRef = { messageID: string; partID: string }
type PartGroup =
  | { key: string; type: "part"; ref: PartRef }
  | { key: string; type: "context"; refs: PartRef[] }

function groupParts(parts: { messageID: string; part: Part }[]): PartGroup[] {
  const result: PartGroup[] = []
  let start = -1
  const flush = (end: number) => {
    if (start < 0) return
    const first = parts[start]
    const last = parts[end]
    if (!first || !last) {
      start = -1
      return
    }
    result.push({
      key: `context:${first.part.id}`,
      type: "context",
      refs: parts.slice(start, end + 1).map((item) => ({ messageID: item.messageID, partID: item.part.id })),
    })
    start = -1
  }
  parts.forEach((item, index) => {
    if (isContextGroupTool(item.part)) {
      if (start < 0) start = index
      return
    }
    flush(index - 1)
    result.push({
      key: `part:${item.messageID}:${item.part.id}`,
      type: "part",
      ref: { messageID: item.messageID, partID: item.part.id },
    })
  })
  flush(parts.length - 1)
  return result
}

// -----------------------------------------------------------------------------
// AssistantParts
// -----------------------------------------------------------------------------

export interface AssistantPartsProps {
  messages: AssistantMessage[]
  showAssistantCopyPartID?: string | null
  turnDurationMs?: number
  working?: boolean
  showReasoningSummaries?: boolean
  shellToolDefaultOpen?: boolean
  editToolDefaultOpen?: boolean
}

export const AssistantParts: React.FC<AssistantPartsProps> = (props) => {
  const data = useData()
  const grouped = React.useMemo(() => {
    const all: { messageID: string; part: Part }[] = []
    for (const message of props.messages) {
      const parts = data.store.part?.[message.id] ?? []
      for (const part of parts) {
        if (renderable(part, props.showReasoningSummaries ?? true)) {
          all.push({ messageID: message.id, part })
        }
      }
    }
    return groupParts(all)
  }, [props.messages, data.store.part, props.showReasoningSummaries])

  const lastKey = grouped[grouped.length - 1]?.key

  return (
    <>
      {grouped.map((entry) => {
        if (entry.type === "context") {
          const tools = entry.refs
            .map((ref) => data.store.part?.[ref.messageID]?.find((p) => p.id === ref.partID))
            .filter((p): p is ToolPart => !!p && isContextGroupTool(p))
          if (tools.length === 0) return null
          const busy = !!props.working && lastKey === entry.key
          return <ContextToolGroup key={entry.key} parts={tools} busy={busy} />
        }

        const message = props.messages.find((m) => m.id === entry.ref.messageID)
        const part = data.store.part?.[entry.ref.messageID]?.find((p) => p.id === entry.ref.partID)
        if (!message || !part) return null
        const defaultOpen =
          part.type === "tool" &&
          ((part as ToolPart).tool === "bash" ? props.shellToolDefaultOpen : ["edit", "write", "apply_patch"].includes((part as ToolPart).tool) ? props.editToolDefaultOpen : undefined)
        return (
          <PartDisplay
            key={entry.key}
            part={part}
            message={message}
            showAssistantCopyPartID={props.showAssistantCopyPartID}
            turnDurationMs={props.turnDurationMs}
            defaultOpen={defaultOpen || undefined}
          />
        )
      })}
    </>
  )
}

// -----------------------------------------------------------------------------
// Message display
// -----------------------------------------------------------------------------

export const Message: React.FC<MessageProps> = (props) => {
  if (props.message.role === "user") {
    return <UserMessageDisplay message={props.message as UserMessage} parts={props.parts} actions={props.actions} />
  }
  if (props.message.role === "assistant") {
    return (
      <AssistantMessageDisplay
        message={props.message as AssistantMessage}
        parts={props.parts}
        showAssistantCopyPartID={props.showAssistantCopyPartID}
        showReasoningSummaries={props.showReasoningSummaries}
      />
    )
  }
  return null
}

const AssistantMessageDisplay: React.FC<{
  message: AssistantMessage
  parts: Part[]
  showAssistantCopyPartID?: string | null
  showReasoningSummaries?: boolean
}> = ({ message, parts, showAssistantCopyPartID, showReasoningSummaries }) => {
  return (
    <AssistantParts
      messages={[message]}
      showAssistantCopyPartID={showAssistantCopyPartID}
      showReasoningSummaries={showReasoningSummaries}
    />
  )
}

// -----------------------------------------------------------------------------
// UserMessageDisplay
// -----------------------------------------------------------------------------

const UserMessageDisplay: React.FC<{
  message: UserMessage
  parts: Part[]
  actions?: UserActions
}> = ({ message, parts, actions }) => {
  const data = useData()
  const dialog = useDialog()
  const i18n = useI18n()
  const [copied, setCopied] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  const textPart = parts.find((p) => p.type === "text" && !(p as TextPart).synthetic) as TextPart | undefined
  const text = textPart?.text || ""
  const files = (parts.filter((p) => p.type === "file") as FilePart[]) ?? []
  const attachments = files.filter(attached)
  const agents = (parts.filter((p) => p.type === "agent") as AgentPart[]) ?? []

  const openImagePreview = (url: string, alt?: string) => {
    dialog.show(() => <ImagePreview src={url} alt={alt} />)
  }
  const handleCopy = async () => {
    if (!text) return
    if (await writeClipboard(text)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }
  const revert = () => {
    if (!actions?.revert || busy) return
    setBusy(true)
    Promise.resolve()
      .then(() => actions.revert!({ sessionID: message.sessionID, messageID: message.id }))
      .finally(() => setBusy(false))
  }

  const metaHead = [message.agent ? message.agent[0]!.toUpperCase() + message.agent.slice(1) : "", ""]
    .filter((x) => !!x)
    .join(" · ")

  return (
    <div data-component="user-message" data-timeline-part-id={textPart?.id}>
      {attachments.length > 0 && (
        <div data-slot="user-message-attachments" className="flex flex-wrap gap-2">
          {attachments.map((file, i) => {
            const type = kind(file)
            const name = file.filename ?? i18n.t("ui.message.attachment.alt")
            return (
              <div
                key={i}
                data-slot="user-message-attachment"
                data-type={type}
                data-clickable={type === "image" ? "true" : undefined}
                title={type === "file" ? name : undefined}
                onClick={() => {
                  if (type === "image" && file.url) openImagePreview(file.url, name)
                }}
                className="flex items-center gap-2 rounded border border-border-weak-base bg-background-stronger p-2"
              >
                {type === "image" ? (
                  <img data-slot="user-message-attachment-image" src={file.url} alt={name} className="h-12 w-12 rounded object-cover" />
                ) : (
                  <div data-slot="user-message-attachment-file" className="flex items-center gap-2">
                    <FileIcon node={{ path: name, type: "file" }} />
                    <span data-slot="user-message-attachment-name">{name}</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      {text && (
        <>
          <div data-slot="user-message-body" className="rounded-lg bg-background-stronger p-3">
            <div data-slot="user-message-text" className="text-13-regular text-text-base">
              <HighlightedText text={text} references={files} agents={agents} />
            </div>
          </div>
          <div data-slot="user-message-copy-wrapper" className="mt-1 flex items-center justify-end gap-2">
            {(metaHead) && (
              <span data-slot="user-message-meta" className="text-12-regular text-text-weak cursor-default">
                {metaHead}
              </span>
            )}
            {actions?.revert && (
              <TooltipWrapper value={i18n.t("ui.message.revertMessage")} placement="top" gutter={4}>
                <IconButton
                  icon="reset"
                  size="normal"
                  variant="ghost"
                  disabled={busy}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(event) => {
                    event.stopPropagation()
                    revert()
                  }}
                  aria-label={i18n.t("ui.message.revertMessage")}
                />
              </TooltipWrapper>
            )}
            <TooltipWrapper
              value={copied ? i18n.t("ui.message.copied") : i18n.t("ui.message.copyMessage")}
              placement="top"
              gutter={4}
            >
              <IconButton
                icon={copied ? "check" : "copy"}
                size="normal"
                variant="ghost"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(event) => {
                  event.stopPropagation()
                  void handleCopy()
                }}
                aria-label={copied ? i18n.t("ui.message.copied") : i18n.t("ui.message.copyMessage")}
              />
            </TooltipWrapper>
          </div>
        </>
      )}
    </div>
  )
}

// -----------------------------------------------------------------------------
// MessageDivider
// -----------------------------------------------------------------------------

export const MessageDivider: React.FC<{ label: string }> = ({ label }) => (
  <div data-component="compaction-part">
    <div data-slot="compaction-part-divider" className="flex items-center gap-2">
      <span data-slot="compaction-part-line" className="h-px flex-1 bg-border-weak-base" />
      <span data-slot="compaction-part-label" className="text-12-regular text-text-weak">
        {label}
      </span>
      <span data-slot="compaction-part-line" className="h-px flex-1 bg-border-weak-base" />
    </div>
  </div>
)

// -----------------------------------------------------------------------------
// Part displayers (registered into PART_MAPPING)
// -----------------------------------------------------------------------------

PART_MAPPING["compaction"] = function CompactionPartDisplay() {
  const i18n = useI18n()
  return <MessageDivider label={i18n.t("ui.messagePart.compaction")} />
}

function readPartText(_delta: Record<string, string> | undefined, part: TextPart | ReasoningPart): string {
  return part.text ?? ""
}

PART_MAPPING["text"] = function TextPartDisplay(props) {
  const data = useData()
  const i18n = useI18n()
  const part = props.part as TextPart
  const interrupted = props.message.role === "assistant" && (props.message as AssistantMessage).error?.name === "MessageAbortedError"
  const numfmt = new Intl.NumberFormat(i18n.locale())

  const model = props.message.role === "assistant"
    ? data.store.provider?.all?.get((props.message as AssistantMessage).providerID)?.models?.[(props.message as AssistantMessage).modelID]?.name ?? (props.message as AssistantMessage).modelID
    : ""

  const message = props.message.role === "assistant" ? (props.message as AssistantMessage) : null
  const completed = message?.time?.completed
  const ms = typeof props.turnDurationMs === "number"
    ? props.turnDurationMs
    : typeof completed === "number" && message
      ? completed - (message.time?.created ?? 0)
      : -1
  let duration = ""
  if (ms >= 0) {
    const total = Math.round(ms / 1000)
    if (total < 60) {
      duration = i18n.t("ui.message.duration.seconds", { count: numfmt.format(total) })
    } else {
      const minutes = Math.floor(total / 60)
      const seconds = total % 60
      duration = i18n.t("ui.message.duration.minutesSeconds", { minutes: numfmt.format(minutes), seconds: numfmt.format(seconds) })
    }
  }

  const meta = message
    ? [message.agent ? message.agent[0]!.toUpperCase() + message.agent.slice(1) : "", model, duration, interrupted ? i18n.t("ui.message.interrupted") : ""].filter((x) => !!x).join(" · ")
    : ""

  const streaming = !!message && typeof message.time?.completed !== "number"
  const text = readPartText(data.store.part_text_accum_delta, part)
  const [copied, setCopied] = React.useState(false)
  const handleCopy = async () => {
    if (!text) return
    if (await writeClipboard(text)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  if (!text) return null
  return (
    <div data-component="text-part" data-timeline-part-id={part.id}>
      <div data-slot="text-part-body">
        <Markdown text={text} cacheKey={part.id} streaming={streaming} />
      </div>
      <div data-slot="text-part-copy-wrapper" data-interrupted={interrupted ? "" : undefined} className="mt-1 flex justify-end gap-2">
        <TooltipWrapper
          value={copied ? i18n.t("ui.message.copied") : i18n.t("ui.message.copyResponse")}
          placement="top"
          gutter={4}
        >
          <IconButton
            icon={copied ? "check" : "copy"}
            size="normal"
            variant="ghost"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleCopy}
            aria-label={copied ? i18n.t("ui.message.copied") : i18n.t("ui.message.copyResponse")}
          />
        </TooltipWrapper>
        {meta && (
          <span data-slot="text-part-meta" className="text-12-regular text-text-weak cursor-default">
            {meta}
          </span>
        )}
      </div>
    </div>
  )
}

PART_MAPPING["reasoning"] = function ReasoningPartDisplay(props) {
  const data = useData()
  const part = props.part as ReasoningPart
  const streaming = props.message.role === "assistant" && typeof (props.message as AssistantMessage).time?.completed !== "number"
  const text = readPartText(data.store.part_text_accum_delta, part)
  if (!text) return null
  return (
    <div data-component="reasoning-part" data-timeline-part-id={part.id}>
      <Markdown text={text} cacheKey={part.id} streaming={streaming} />
    </div>
  )
}

// -----------------------------------------------------------------------------
// Tool part displayer
// -----------------------------------------------------------------------------

PART_MAPPING["tool"] = function ToolPartDisplay(props) {
  const part = props.part as ToolPart
  const i18n = useI18n()

  if (part.tool === "todowrite") return null
  if (part.tool === "question" && (part.state.status === "pending" || part.state.status === "running")) return null

  const input = part.state.input ?? {}
  const metadata = part.state.metadata ?? {}
  const taskId = typeof metadata.sessionId === "string" ? metadata.sessionId : undefined
  const taskSubtitle = typeof input.description === "string" && input.description ? input.description : taskId

  if (part.state.status === "error" && part.state.error) {
    const cleaned = part.state.error.replace("Error: ", "")
    if (part.tool === "question" && cleaned.includes("dismissed this question")) {
      return (
        <div className="flex w-full justify-end">
          <span className="text-13-regular text-text-weak cursor-default">
            {i18n.t("ui.messagePart.questions.dismissed")}
          </span>
        </div>
      )
    }
    return (
      <ToolErrorCard
        tool={part.tool}
        error={part.state.error}
        title={part.tool === "websearch" ? webSearchProviderLabel(metadata.provider) : undefined}
        defaultOpen={props.defaultOpen}
        open={props.onToolOpenChange ? props.toolOpen : undefined}
        onOpenChange={props.onToolOpenChange}
        subtitle={taskSubtitle}
      />
    )
  }

  const Render = getTool(part.tool) ?? GenericTool
  return (
    <div data-component="tool-part-wrapper" data-timeline-part-id={part.id}>
      <Render
        input={input}
        metadata={metadata}
        tool={part.tool}
        sessionID={part.sessionID}
        output={part.state.output as string | undefined}
        status={part.state.status}
        hideDetails={props.hideDetails}
        defaultOpen={props.defaultOpen}
        open={props.onToolOpenChange ? props.toolOpen : undefined}
        onOpenChange={props.onToolOpenChange}
        deferContent={props.deferToolContent}
        virtualizeDiff={props.virtualizeDiff}
        onContentRendered={props.onContentRendered}
      />
    </div>
  )
}

// -----------------------------------------------------------------------------
// Default tool registrations
// -----------------------------------------------------------------------------

ToolRegistry.register("read", (props) => {
  const i18n = useI18n()
  const args: string[] = []
  if (props.input.offset) args.push("offset=" + String(props.input.offset))
  if (props.input.limit) args.push("limit=" + String(props.input.limit))
  return (
    <BasicTool
      {...props}
      icon="glasses"
      trigger={{
        title: i18n.t("ui.tool.read"),
        subtitle: props.input.filePath ? getFilename(String(props.input.filePath)) : "",
        args,
      }}
    />
  )
})

ToolRegistry.register("list", (props) => {
  const i18n = useI18n()
  return (
    <BasicTool
      {...props}
      icon="bullet-list"
      trigger={{ title: i18n.t("ui.tool.list"), subtitle: getDirectory(String(props.input.path || "/")) }}
    >
      {props.output ? (
        <div data-component="tool-output" data-scrollable>
          <Markdown text={String(props.output)} />
        </div>
      ) : null}
    </BasicTool>
  )
})

ToolRegistry.register("glob", (props) => {
  const i18n = useI18n()
  return (
    <BasicTool
      {...props}
      icon="magnifying-glass-menu"
      trigger={{
        title: i18n.t("ui.tool.glob"),
        subtitle: getDirectory(String(props.input.path || "/")),
        args: props.input.pattern ? ["pattern=" + String(props.input.pattern)] : [],
      }}
    >
      {props.output ? (
        <div data-component="tool-output" data-scrollable>
          <Markdown text={String(props.output)} />
        </div>
      ) : null}
    </BasicTool>
  )
})

ToolRegistry.register("grep", (props) => {
  const i18n = useI18n()
  const args: string[] = []
  if (props.input.pattern) args.push("pattern=" + String(props.input.pattern))
  if (props.input.include) args.push("include=" + String(props.input.include))
  return (
    <BasicTool
      {...props}
      icon="magnifying-glass-menu"
      trigger={{
        title: i18n.t("ui.tool.grep"),
        subtitle: getDirectory(String(props.input.path || "/")),
        args,
      }}
    >
      {props.output ? (
        <div data-component="tool-output" data-scrollable>
          <Markdown text={String(props.output)} />
        </div>
      ) : null}
    </BasicTool>
  )
})

ToolRegistry.register("bash", (props) => {
  const i18n = useI18n()
  const pending = props.status === "pending" || props.status === "running"
  const cmd = (props.input.command ?? props.metadata.command ?? "") as string
  const text = `$ ${cmd}`
  const [copied, setCopied] = React.useState(false)
  const handleCopy = async () => {
    if (await writeClipboard(text)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }
  return (
    <BasicTool
      {...props}
      icon="console"
      trigger={
        <div data-slot="basic-tool-tool-info-structured">
          <div data-slot="basic-tool-tool-info-main">
            <span data-slot="basic-tool-tool-title">
              <TextShimmer text={i18n.t("ui.tool.shell")} active={pending} />
            </span>
            {!pending && props.input.description ? (
              <ShellSubmessage text={String(props.input.description)} animate={pending} />
            ) : null}
          </div>
        </div>
      }
    >
      <div data-component="bash-output">
        <div data-slot="bash-scroll" data-scrollable className="rounded bg-background-base p-3">
          <pre data-slot="bash-pre" className="text-12-regular whitespace-pre-wrap text-text-base">
            <code>{text}</code>
          </pre>
        </div>
        <div data-slot="bash-copy" className="flex justify-end">
          <TooltipWrapper value={copied ? i18n.t("ui.message.copied") : i18n.t("ui.message.copy")} placement="top" gutter={4}>
            <IconButton
              icon={copied ? "check" : "copy"}
              size="small"
              variant="secondary"
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleCopy}
              aria-label={copied ? i18n.t("ui.message.copied") : i18n.t("ui.message.copy")}
            />
          </TooltipWrapper>
        </div>
      </div>
    </BasicTool>
  )
})

ToolRegistry.register("edit", (props) => {
  const i18n = useI18n()
  const diagnostics = getDiagnostics(props.metadata.diagnostics as Record<string, Diagnostic[]> | undefined, props.input.filePath as string | undefined)
  const pending = props.status === "pending" || props.status === "running"
  const filename = getFilename(String(props.input.filePath ?? ""))
  return (
    <div data-component="edit-tool">
      <BasicTool
        {...props}
        icon="code-lines"
        defer={props.deferContent !== false}
        trigger={
          <div data-component="edit-trigger">
            <div data-slot="message-part-title-area">
              <div data-slot="message-part-title">
                <span data-slot="message-part-title-text">
                  <TextShimmer text={i18n.t("ui.messagePart.title.edit")} active={pending} />
                </span>
                {!pending && <span data-slot="message-part-title-filename">{filename}</span>}
              </div>
              {!pending && String(props.input.filePath ?? "").includes("/") && (
                <div data-slot="message-part-path">
                  <span data-slot="message-part-directory">{getDirectory(String(props.input.filePath))}</span>
                </div>
              )}
            </div>
          </div>
        }
      >
        <DiagnosticsDisplay diagnostics={diagnostics} />
      </BasicTool>
    </div>
  )
})

ToolRegistry.register("write", (props) => {
  const i18n = useI18n()
  const diagnostics = getDiagnostics(props.metadata.diagnostics as Record<string, Diagnostic[]> | undefined, props.input.filePath as string | undefined)
  const pending = props.status === "pending" || props.status === "running"
  const filename = getFilename(String(props.input.filePath ?? ""))
  return (
    <div data-component="write-tool">
      <BasicTool
        {...props}
        icon="code-lines"
        defer={props.deferContent !== false}
        trigger={
          <div data-component="write-trigger">
            <div data-slot="message-part-title-area">
              <div data-slot="message-part-title">
                <span data-slot="message-part-title-text">
                  <TextShimmer text={i18n.t("ui.messagePart.title.write")} active={pending} />
                </span>
                {!pending && <span data-slot="message-part-title-filename">{filename}</span>}
              </div>
              {!pending && String(props.input.filePath ?? "").includes("/") && (
                <div data-slot="message-part-path">
                  <span data-slot="message-part-directory">{getDirectory(String(props.input.filePath))}</span>
                </div>
              )}
            </div>
          </div>
        }
      >
        <DiagnosticsDisplay diagnostics={diagnostics} />
      </BasicTool>
    </div>
  )
})

ToolRegistry.register("apply_patch", (props) => {
  const i18n = useI18n()
  const pending = props.status === "pending" || props.status === "running"
  return (
    <BasicTool
      {...props}
      icon="code-lines"
      defer={props.deferContent !== false}
      trigger={{
        title: i18n.t("ui.tool.patch"),
      }}
    />
  )
})

ToolRegistry.register("todowrite", (props) => {
  const i18n = useI18n()
  const todos = (props.metadata.todos as Todo[] | undefined) ?? (props.input.todos as Todo[] | undefined) ?? []
  const subtitle = todos.length === 0 ? "" : `${todos.filter((t) => t.status === "completed").length}/${todos.length}`
  return (
    <BasicTool
      {...props}
      defaultOpen
      icon="checklist"
      trigger={{ title: i18n.t("ui.tool.todos"), subtitle }}
    >
      {todos.length > 0 && (
        <div data-component="todos" className="flex flex-col gap-1">
          {todos.map((todo, i) => (
            <Checkbox.Root
              key={i}
              checked={todo.status === "completed"}
              className="flex items-center gap-2"
            >
              <Checkbox.Indicator>
                <span>{todo.status === "completed" ? "✓" : ""}</span>
              </Checkbox.Indicator>
              <span data-slot="message-part-todo-content" data-completed={todo.status === "completed" ? "completed" : undefined}>
                {todo.content}
              </span>
            </Checkbox.Root>
          ))}
        </div>
      )}
    </BasicTool>
  )
})

ToolRegistry.register("question", (props) => {
  const i18n = useI18n()
  const questions = (props.input.questions as QuestionInfo[] | undefined) ?? []
  const rawAnswers = (props.metadata.answers as unknown) ?? []
  const answerList: string[] = Array.isArray(rawAnswers) ? rawAnswers.map((a) => (typeof a === "string" ? a : String((a as { answer?: string })?.answer ?? ""))) : []
  const completed = answerList.length > 0
  const count = questions.length
  const subtitle = count === 0 ? "" : completed ? i18n.t("ui.question.subtitle.answered", { count }) : `${count} ${i18n.t(count > 1 ? "ui.common.question.other" : "ui.common.question.one")}`
  return (
    <BasicTool
      {...props}
      defaultOpen={completed}
      icon="bubble-5"
      trigger={{ title: i18n.t("ui.tool.questions"), subtitle }}
    >
      {completed && (
        <div data-component="question-answers" className="flex flex-col gap-2">
          {questions.map((q, i) => (
            <div key={i} data-slot="question-answer-item">
              <div data-slot="question-text" className="text-13-medium text-text-base">{q.question}</div>
              <div data-slot="answer-text" className="text-13-regular text-text-weak">
                {answerList[i] || i18n.t("ui.question.answer.none")}
              </div>
            </div>
          ))}
        </div>
      )}
    </BasicTool>
  )
})

ToolRegistry.register("skill", (props) => {
  const i18n = useI18n()
  const title = (props.input.name as string) || i18n.t("ui.tool.skill")
  const running = props.status === "pending" || props.status === "running"
  return (
    <BasicTool
      icon="brain"
      status={props.status}
      hideDetails
      trigger={
        <div data-slot="basic-tool-tool-info-structured">
          <div data-slot="basic-tool-tool-info-main">
            <span data-slot="basic-tool-tool-title" className="capitalize agent-title">
              <TextShimmer text={title} active={running} />
            </span>
          </div>
        </div>
      }
    />
  )
})

ToolRegistry.register("webfetch", (props) => {
  const i18n = useI18n()
  const pending = props.status === "pending" || props.status === "running"
  const url = typeof props.input.url === "string" ? props.input.url : ""
  return (
    <BasicTool
      {...props}
      hideDetails
      icon="window-cursor"
      trigger={
        <div data-slot="basic-tool-tool-info-structured">
          <div data-slot="basic-tool-tool-info-main">
            <span data-slot="basic-tool-tool-title">
              <TextShimmer text={i18n.t("ui.tool.webfetch")} active={pending} />
            </span>
            {!pending && url && (
              <a
                data-slot="basic-tool-tool-subtitle"
                className="clickable subagent-link"
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => event.stopPropagation()}
              >
                {url}
              </a>
            )}
          </div>
        </div>
      }
    />
  )
})

ToolRegistry.register("websearch", (props) => {
  const i18n = useI18n()
  const query = typeof props.input.query === "string" ? props.input.query : ""
  return (
    <BasicTool
      {...props}
      icon="window-cursor"
      trigger={{
        title: webSearchProviderLabel(props.metadata.provider),
        subtitle: query,
        subtitleClass: "exa-tool-query",
      }}
    />
  )
})

ToolRegistry.register("task", (props) => {
  const i18n = useI18n()
  const agent = taskAgent(props.input.subagent_type)
  const title = agent.name ?? i18n.t("ui.tool.agent.default")
  const running = props.status === "pending" || props.status === "running"
  return (
    <BasicTool
      icon="task"
      status={props.status}
      hideDetails
      trigger={
        <div data-component="task-tool-card">
          <div data-slot="basic-tool-tool-info-structured">
            <div data-slot="basic-tool-tool-info-main">
              {running && (
                <span data-component="task-tool-spinner" style={{ color: agent.color ?? "var(--icon-interactive-base)" }}>
                  <Spinner />
                </span>
              )}
              <span data-component="task-tool-title" style={{ color: agent.color ?? "var(--text-strong)" }}>
                {title}
              </span>
            </div>
          </div>
        </div>
      }
    />
  )
})

// -----------------------------------------------------------------------------
// Context providers (exported for consumers)
// -----------------------------------------------------------------------------

export interface MessagePartContextValue extends DataCtxValue, DialogApi {}

export const MessagePartProvider: React.FC<{
  data?: DataCtxValue
  dialog?: DialogApi
  i18n?: I18nProviderProps["value"]
  fileComponent?: React.ComponentType<{ mode?: string; [key: string]: unknown }>
  children: React.ReactNode
}> = ({ data, dialog, i18n, fileComponent, children }) => {
  return (
    <I18nProvider value={i18n}>
      <DataContext.Provider value={data ?? { store: {} }}>
        <DialogContext.Provider value={dialog ?? null}>
          <FileContext.Provider value={fileComponent ?? null}>{children}</FileContext.Provider>
        </DialogContext.Provider>
      </DataContext.Provider>
    </I18nProvider>
  )
}

// Helpers used by other components in this package
export {
  PART_MAPPING,
  PART_MAPPING as PartMapping,
  getFilename,
  getDirectory,
  relativizeProjectPath,
  writeClipboard,
  getToolInfo,
}

// Re-export needed types
export type { ToolInfo, PartRef, PartGroup }