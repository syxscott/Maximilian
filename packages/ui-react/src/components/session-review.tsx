"use client"

import * as React from "react"
import * as Accordion from "@radix-ui/react-accordion"
import * as RadioGroup from "@radix-ui/react-radio-group"
import * as Tooltip from "@radix-ui/react-tooltip"
import * as DropdownMenu from "@radix-ui/react-dropdown-menu"
import { cn } from "../lib/utils.js"

export type SessionReviewDiffStyle = "unified" | "split"

export interface SelectedLineRange {
  start: number
  end: number
  side?: "deletions" | "additions"
  endSide?: "deletions" | "additions"
}

export interface SessionReviewComment {
  id: string
  file: string
  selection: SelectedLineRange
  comment: string
}

export interface SessionReviewLineComment {
  file: string
  selection: SelectedLineRange
  comment: string
  preview?: string
}

export interface SessionReviewCommentUpdate extends SessionReviewLineComment {
  id: string
}

export interface SessionReviewCommentDelete {
  id: string
  file: string
}

export interface SessionReviewCommentActions {
  moreLabel: string
  editLabel: string
  deleteLabel: string
  saveLabel: string
}

export interface SessionReviewFocus {
  file: string
  id: string
}

export interface FileContent {
  name?: string
  contents?: string
  mimeType?: string
}

export interface SnapshotFileDiff {
  file?: string
  additions?: number
  deletions?: number
  patch?: string
  before?: string
  after?: string
  status?: "added" | "deleted" | "modified"
}

export interface RawReviewDiff extends SnapshotFileDiff {
  file: string
}

export interface SessionReviewProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title?: React.ReactNode
  empty?: React.ReactNode
  split?: boolean
  diffStyle?: SessionReviewDiffStyle
  onDiffStyleChange?: (diffStyle: SessionReviewDiffStyle) => void
  onDiffRendered?: () => void
  onLineComment?: (comment: SessionReviewLineComment) => void
  onLineCommentUpdate?: (comment: SessionReviewCommentUpdate) => void
  onLineCommentDelete?: (comment: SessionReviewCommentDelete) => void
  lineCommentActions?: SessionReviewCommentActions
  comments?: SessionReviewComment[]
  focusedComment?: SessionReviewFocus | null
  onFocusedCommentChange?: (focus: SessionReviewFocus | null) => void
  focusedFile?: string
  open?: string[]
  onOpenChange?: (open: string[]) => void
  scrollRef?: (el: HTMLDivElement | null) => void
  onScroll?: React.UIEventHandler<HTMLDivElement>
  classes?: { root?: string; header?: string; container?: string }
  actions?: React.ReactNode
  diffs: RawReviewDiff[]
  onViewFile?: (file: string) => void
  readFile?: (path: string) => Promise<FileContent | undefined>
  lineCommentMention?: unknown
  fileComponent?: React.ComponentType<{ mode?: string; [key: string]: unknown }>
}

interface DataCtxValue {
  fileComponent?: React.ComponentType<{ mode?: string; [key: string]: unknown }>
  directory?: string
  navigateToSession?: (id: string) => void
}

const FileContext = React.createContext<React.ComponentType<{ mode?: string; [key: string]: unknown }> | null>(null)
const useFileComponent = (): React.ComponentType<{ mode?: string; [key: string]: unknown }> => {
  return React.useContext(FileContext) ?? (() => (
    <div className="rounded border border-border-weak-base bg-background-base p-4 text-12-regular text-text-weak">
      File viewer unavailable
    </div>
  ))
}

const DataContext = React.createContext<DataCtxValue | null>(null)
const useData = (): DataCtxValue => React.useContext(DataContext) ?? {}

interface I18nContextValue {
  t: (key: string, params?: Record<string, string | number>) => string
  locale: () => string
}
const I18nContext = React.createContext<I18nContextValue>({
  t: (key) => key,
  locale: () => "en",
})
const useI18n = () => React.useContext(I18nContext)

const ScrollView = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ children, className, ...rest }, ref) => {
    return (
      <div ref={ref} className={cn("h-full overflow-y-auto", className)} {...rest}>
        {children}
      </div>
    )
  },
)
ScrollView.displayName = "ScrollView"

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

const FileIcon: React.FC<{ node?: { path?: string; type?: string } }> = ({ node }) => (
  <span data-slot="file-icon" data-name={node?.path?.split(".").pop()} className="inline-block h-4 w-4 rounded bg-background-stronger" />
)

const Icon: React.FC<{ name: string; size?: "small" | "normal"; style?: React.CSSProperties }> = ({ name, size = "normal", style }) => (
  <span data-slot="icon" data-icon={name} data-size={size} style={style} className="inline-block">
    <svg width={size === "small" ? 12 : 16} height={size === "small" ? 12 : 16} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6" fill="currentColor" opacity="0.2" />
    </svg>
  </span>
)

const IconButton = React.forwardRef<HTMLButtonElement, {
  icon?: string
  variant?: "ghost" | "secondary"
  size?: "small" | "normal"
  className?: string
  "aria-label"?: string
  children?: React.ReactNode
  onClick?: React.MouseEventHandler
  onMouseDown?: React.MouseEventHandler
}>(({ icon, variant = "ghost", size = "normal", className, children, ...rest }, ref) => {
  return (
    <button
      ref={ref}
      type="button"
      data-component="icon-button"
      data-icon={icon}
      data-variant={variant}
      data-size={size}
      className={cn("inline-flex items-center justify-center rounded p-1 hover:bg-background-stronger", className)}
      {...rest}
    >
      <Icon name={icon ?? "dot"} size={size} />
      {children}
    </button>
  )
})
IconButton.displayName = "IconButton"

const Button: React.FC<{
  size?: "small" | "normal"
  icon?: string
  variant?: "primary" | "secondary" | "ghost"
  className?: string
  onClick?: React.MouseEventHandler
  children?: React.ReactNode
}> = ({ size = "normal", icon, variant = "primary", className, onClick, children }) => (
  <button
    type="button"
    data-component="button"
    data-size={size}
    data-variant={variant}
    onClick={onClick}
    className={cn(
      "inline-flex items-center justify-center gap-1 rounded px-3 py-1.5 text-13-medium hover:bg-background-stronger",
      variant === "secondary" && "bg-background-base border border-border-weak-base",
      className,
    )}
  >
    {icon && <Icon name={icon} size={size} />}
    {children}
  </button>
)

const DiffChanges: React.FC<{ changes: { additions?: number; deletions?: number } | unknown }> = ({ changes }) => {
  const c = changes as { additions?: number; deletions?: number }
  return (
    <span data-component="diff-changes" className="inline-flex items-center gap-1 text-12-regular text-text-weak">
      <span data-slot="additions" className="text-syntax-success">+{c?.additions ?? 0}</span>
      <span data-slot="deletions" className="text-syntax-error">−{c?.deletions ?? 0}</span>
    </span>
  )
}

const MAX_DIFF_CHANGED_LINES = 500

function normalize(value: RawReviewDiff) {
  return {
    file: value.file,
    additions: value.additions ?? 0,
    deletions: value.deletions ?? 0,
    status: value.status ?? "modified",
    fileDiff: value,
  }
}

const ReviewCommentMenu: React.FC<{
  labels: SessionReviewCommentActions
  onEdit: () => void
  onDelete: () => void
}> = ({ labels, onEdit, onDelete }) => {
  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <IconButton icon="dot-grid" variant="ghost" size="small" className="size-6 rounded-md" aria-label={labels.moreLabel} />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content sideOffset={4} align="end" className="rounded-md border border-border-weak-base bg-background-base p-1 shadow-md">
            <DropdownMenu.Item onSelect={onEdit} className="cursor-pointer rounded px-2 py-1 text-13-regular hover:bg-background-stronger">
              {labels.editLabel}
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={onDelete} className="cursor-pointer rounded px-2 py-1 text-13-regular hover:bg-background-stronger">
              {labels.deleteLabel}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}

const StickyAccordionHeader: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div data-slot="sticky-accordion-header" className="sticky top-0 z-10 bg-background-base">
    {children}
  </div>
)

const TooltipWrapper: React.FC<{
  value: string
  children: React.ReactNode
  placement?: "top" | "bottom" | "left" | "right"
  gutter?: number
}> = ({ value, children, placement = "top", gutter = 4 }) => (
  <Tooltip.Root>
    <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content side={placement} sideOffset={gutter} className="rounded bg-background-stronger px-2 py-1 text-12-regular text-text-base shadow-md">
        {value}
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>
)

export const SessionReview: React.FC<SessionReviewProps> = (props) => {
  const i18n = useI18n()
  const fileComponent = useFileComponent()
  const data = useData()
  const Component = props.fileComponent ?? fileComponent ?? data.fileComponent

  const internalScrollRef = React.useRef<HTMLDivElement | null>(null)
  const scroll: React.MutableRefObject<HTMLDivElement | null> = React.useRef(null)
  scroll.current = internalScrollRef.current

  const [store, setStore] = React.useState({
    open: [] as string[],
    visible: {} as Record<string, boolean>,
    force: {} as Record<string, boolean>,
    selection: null as { file: string; range: SelectedLineRange } | null,
    commenting: null as { file: string; range: SelectedLineRange } | null,
    opened: null as SessionReviewFocus | null,
  })
  const open = props.open ?? store.open
  const files = React.useMemo(() => props.diffs.map((d) => d.file), [props.diffs])
  const hasDiffs = files.length > 0

  const itemsMap = React.useMemo(() => {
    const map: Record<string, ReturnType<typeof normalize>> = {}
    for (const diff of props.diffs) {
      map[diff.file] = normalize(diff)
    }
    return map
  }, [props.diffs])

  const grouped = React.useMemo(() => {
    const next = new Map<string, SessionReviewComment[]>()
    for (const comment of props.comments ?? []) {
      const list = next.get(comment.file)
      if (list) list.push(comment)
      else next.set(comment.file, [comment])
    }
    return next
  }, [props.comments])

  const diffStyle = props.diffStyle ?? (props.split ? "split" : "unified")

  const handleChange = (next: string[]) => {
    props.onOpenChange?.(next)
    if (props.open === undefined) setStore((s) => ({ ...s, open: next }))
  }

  const handleExpandOrCollapseAll = () => {
    handleChange(open.length > 0 ? [] : files)
  }

  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    props.onScroll?.(event)
  }

  const openFileLabel = "Open file"

  return (
    <div data-component="session-review" className={cn("flex h-full flex-col", props.className)}>
      <div data-slot="session-review-header" className={cn("flex items-center justify-between border-b border-border-weak-base p-3", props.classes?.header)}>
        <div data-slot="session-review-title" className="text-14-medium text-text-strong">
          {props.title ?? "Review"}
        </div>
        <div data-slot="session-review-actions" className="flex items-center gap-2">
          {hasDiffs && props.onDiffStyleChange && (
            <RadioGroup.Root
              value={diffStyle}
              onValueChange={(value) => props.onDiffStyleChange?.(value as SessionReviewDiffStyle)}
              className="flex items-center gap-1 rounded-md border border-border-weak-base p-0.5"
            >
              <RadioGroup.Item value="unified" className={cn("rounded px-2 py-1 text-12-regular", diffStyle === "unified" && "bg-background-stronger")}>
                Unified
              </RadioGroup.Item>
              <RadioGroup.Item value="split" className={cn("rounded px-2 py-1 text-12-regular", diffStyle === "split" && "bg-background-stronger")}>
                Split
              </RadioGroup.Item>
            </RadioGroup.Root>
          )}
          {hasDiffs && (
            <Button size="small" icon="chevron-grabber-vertical" className="w-[106px] justify-start" onClick={handleExpandOrCollapseAll}>
              {open.length > 0 ? "Collapse all" : "Expand all"}
            </Button>
          )}
          {props.actions}
        </div>
      </div>

      <ScrollView
        ref={(el) => {
          internalScrollRef.current = el
          props.scrollRef?.(el)
        }}
        onScroll={handleScroll}
        className={cn("flex-1", props.classes?.root)}
      >
        <div data-slot="session-review-container" className={cn("p-3", props.classes?.container)}>
          {!hasDiffs ? (
            props.empty
          ) : (
            <div className="pb-6">
              <Accordion.Root
                type="multiple"
                value={open}
                onValueChange={(value) => handleChange(Array.isArray(value) ? value : value ? [value] : [])}
              >
                {files.map((file) => {
                  const diff = itemsMap[file]
                  if (!diff) return null
                  const expanded = open.includes(file)
                  const changedLines = diff.additions + diff.deletions
                  const tooLarge = expanded && !store.force[file] && changedLines > MAX_DIFF_CHANGED_LINES
                  const comments = grouped.get(file) ?? []
                  const commentedLines = comments.map((c) => c.selection)
                  const isAdded = diff.status === "added"
                  const isDeleted = diff.status === "deleted"

                  return (
                    <Accordion.Item
                      key={file}
                      value={file}
                      id={`session-review-diff-${file}`}
                      data-file={file}
                      data-slot="session-review-accordion-item"
                      data-selected={props.focusedFile === file ? "" : undefined}
                      className="border-b border-border-weak-base"
                    >
                      <StickyAccordionHeader>
                        <Accordion.Header>
                          <Accordion.Trigger className="flex w-full items-center justify-between gap-2 px-4 py-2 text-left">
                            <div data-slot="session-review-trigger-content" className="flex w-full items-center justify-between gap-2">
                              <div data-slot="session-review-file-info" className="flex items-center gap-2">
                                <FileIcon node={{ path: file, type: "file" }} />
                                <div data-slot="session-review-file-name-container">
                                  {file.includes("/") && (
                                    <span data-slot="session-review-directory" className="text-12-regular text-text-weak">
                                      {getDirectory(file)}/
                                    </span>
                                  )}
                                  <span data-slot="session-review-filename" className="text-13-medium text-text-base">
                                    {getFilename(file)}
                                  </span>
                                </div>
                              </div>
                              <div data-slot="session-review-trigger-actions" className="flex items-center gap-2">
                                {isAdded ? (
                                  <span data-slot="session-review-change" data-type="added" className="text-12-regular text-syntax-success">
                                    Added
                                  </span>
                                ) : isDeleted ? (
                                  <span data-slot="session-review-change" data-type="removed" className="text-12-regular text-syntax-error">
                                    Removed
                                  </span>
                                ) : (
                                  <DiffChanges changes={diff} />
                                )}
                                <span data-slot="session-review-diff-chevron">
                                  <Icon name="chevron-down" size="small" />
                                </span>
                              </div>
                            </div>
                          </Accordion.Trigger>
                        </Accordion.Header>
                      </StickyAccordionHeader>
                      <Accordion.Content data-slot="session-review-accordion-content">
                        {expanded && (
                          <div data-slot="session-review-diff-wrapper" className="p-2">
                            {tooLarge ? (
                              <div data-slot="session-review-large-diff" className="rounded-lg border border-border-weak-base bg-background-base p-6 text-center">
                                <div data-slot="session-review-large-diff-title" className="text-14-semibold text-text-base">
                                  Large diff
                                </div>
                                <div data-slot="session-review-large-diff-meta" className="text-12-regular text-text-weak">
                                  Limit {MAX_DIFF_CHANGED_LINES.toLocaleString()}, current {changedLines.toLocaleString()}
                                </div>
                                <div data-slot="session-review-large-diff-actions" className="mt-3 flex justify-center">
                                  <Button size="normal" variant="secondary" onClick={() => setStore((s) => ({ ...s, force: { ...s.force, [file]: true } }))}>
                                    Render anyway
                                  </Button>
                                </div>
                              </div>
                            ) : Component ? (
                              React.createElement(Component, {
                                mode: "diff",
                                fileDiff: diff.fileDiff,
                                diffStyle,
                                onRendered: () => props.onDiffRendered?.(),
                                enableLineSelection: !!props.onLineComment,
                                enableHoverUtility: !!props.onLineComment,
                                selectedLines: store.selection?.file === file ? store.selection.range : null,
                                commentedLines,
                                media: {
                                  mode: "auto",
                                  path: file,
                                  deleted: diff.status === "deleted",
                                  readFile: diff.status === "deleted" ? undefined : props.readFile,
                                },
                              })
                            ) : (
                              <div className="rounded border border-border-weak-base bg-background-base p-4 text-12-regular text-text-weak">
                                File viewer unavailable
                              </div>
                            )}
                          </div>
                        )}
                      </Accordion.Content>
                    </Accordion.Item>
                  )
                })}
              </Accordion.Root>
            </div>
          )}
        </div>
      </ScrollView>
    </div>
  )
}

export interface SessionReviewContextValue extends DataCtxValue {
  i18n?: { t: (key: string, params?: Record<string, string | number>) => string; locale?: () => string }
}

export const SessionReviewProvider: React.FC<{
  value?: SessionReviewContextValue
  children: React.ReactNode
}> = ({ value, children }) => {
  const fallbackI18n: I18nContextValue = React.useMemo(
    () => ({ t: (key) => key, locale: () => "en" }),
    [],
  )
  const i18nCtx: I18nContextValue = React.useMemo(() => {
    const v = value?.i18n
    if (!v) return fallbackI18n
    return {
      t: v.t,
      locale: v.locale ?? (() => "en"),
    }
  }, [value?.i18n, fallbackI18n])
  return (
    <I18nContext.Provider value={i18nCtx}>
      <FileContext.Provider value={value?.fileComponent ?? null}>
        <DataContext.Provider value={value ?? null}>{children}</DataContext.Provider>
      </FileContext.Provider>
    </I18nContext.Provider>
  )
}