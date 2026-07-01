import {
  type CSSProperties,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
  type FocusEvent as ReactFocusEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { cn } from "../lib/utils"

export type LineCommentVariant = "default" | "editor" | "add"

function InlineGlyph({ icon }: { icon: "comment" | "plus" }) {
  return (
    <svg
      data-slot="line-comment-icon"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      {icon === "comment" ? (
        <path
          d="M16.25 3.75H3.75V16.25L6.875 14.4643H16.25V3.75Z"
          stroke="currentColor"
          strokeLinecap="square"
        />
      ) : (
        <path
          d="M10 5.41699V10.0003M10 10.0003V14.5837M10 10.0003H5.4165M10 10.0003H14.5832"
          stroke="currentColor"
          strokeLinecap="square"
        />
      )}
    </svg>
  )
}

export interface LineCommentAnchorProps {
  id?: string
  top?: number
  inline?: boolean
  hideButton?: boolean
  open: boolean
  variant?: LineCommentVariant
  icon?: "comment" | "plus"
  buttonLabel?: string
  onClick?: (e: ReactMouseEvent<HTMLButtonElement>) => void
  onMouseEnter?: (e: ReactMouseEvent<HTMLButtonElement>) => void
  onPopoverFocusOut?: (e: ReactFocusEvent<HTMLDivElement>) => void
  className?: string
  popoverClass?: string
  children?: ReactNode
}

export function LineCommentAnchor(props: LineCommentAnchorProps) {
  const {
    id,
    top,
    inline,
    hideButton,
    open,
    variant = "default",
    icon = "comment",
    buttonLabel,
    onClick,
    onMouseEnter,
    onPopoverFocusOut,
    className,
    popoverClass,
    children,
  } = props

  const hidden = !inline && top === undefined
  const inlineBody = inline && hideButton

  const style: CSSProperties | undefined = inline
    ? undefined
    : {
        top: `${top ?? 0}px`,
        opacity: hidden ? 0 : 1,
        pointerEvents: hidden ? "none" : "auto",
      }

  return (
    <div
      data-component="line-comment"
      data-prevent-autofocus=""
      data-variant={variant}
      data-comment-id={id}
      data-open={open ? "" : undefined}
      data-inline={inline ? "" : undefined}
      className={cn(className)}
      style={style}
    >
      {inlineBody ? (
        <div
          data-slot="line-comment-popover"
          data-inline-body=""
          className={cn(popoverClass)}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onClick ? (onClick as unknown as (e: ReactMouseEvent<HTMLDivElement>) => void) : undefined}
          onMouseEnter={
            onMouseEnter
              ? (onMouseEnter as unknown as (e: ReactMouseEvent<HTMLDivElement>) => void)
              : undefined
          }
          onBlur={onPopoverFocusOut}
        >
          {children}
        </div>
      ) : (
        <>
          <button
            type="button"
            aria-label={buttonLabel}
            data-slot="line-comment-button"
            onMouseDown={(e) => e.stopPropagation()}
            onMouseUp={(e) => e.stopPropagation()}
            onClick={onClick}
            onMouseEnter={onMouseEnter}
          >
            {inline ? (
              <InlineGlyph icon={icon} />
            ) : (
              <span data-slot="line-comment-icon-wrap">{icon === "plus" ? "+" : "C"}</span>
            )}
          </button>
          {open && (
            <div
              data-slot="line-comment-popover"
              className={cn(popoverClass)}
              onMouseDown={(e) => e.stopPropagation()}
              onBlur={onPopoverFocusOut}
            >
              {children}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export interface LineCommentProps
  extends Omit<LineCommentAnchorProps, "children" | "variant"> {
  comment: ReactNode
  selection: ReactNode
  actions?: ReactNode
}

export function LineComment(props: LineCommentProps) {
  const { comment, selection, actions, ...rest } = props
  return (
    <LineCommentAnchor {...rest} variant="default" hideButton={props.inline}>
      <div data-slot="line-comment-content">
        <div data-slot="line-comment-head">
          <div data-slot="line-comment-text">{comment}</div>
          {actions && <div data-slot="line-comment-tools">{actions}</div>}
        </div>
        <div data-slot="line-comment-label">
          <span data-slot="line-comment-label-prefix">Comment on </span>
          {selection}
          <span data-slot="line-comment-label-suffix">:</span>
        </div>
      </div>
    </LineCommentAnchor>
  )
}

export interface LineCommentAddProps
  extends Omit<LineCommentAnchorProps, "children" | "variant" | "open" | "icon"> {
  label?: string
}

export function LineCommentAdd(props: LineCommentAddProps) {
  const { label = "Comment", ...rest } = props
  return (
    <LineCommentAnchor
      {...rest}
      open={false}
      variant="add"
      icon="plus"
      buttonLabel={label}
    />
  )
}

export interface LineCommentEditorProps
  extends Omit<LineCommentAnchorProps, "children" | "open" | "variant" | "onClick"> {
  value: string
  selection: ReactNode
  onInput: (value: string) => void
  onCancel: () => void
  onSubmit: (value: string) => void
  placeholder?: string
  rows?: number
  autofocus?: boolean
  cancelLabel?: string
  submitLabel?: string
  mention?: {
    items: (query: string) => string[] | Promise<string[]>
  }
}

function basename(p: string) {
  return p.split("\\").join("/").split("/").filter(Boolean).pop() ?? ""
}

function dirname(p: string) {
  const b = basename(p)
  return p.slice(0, p.length - b.length).replace(/\/$/, "")
}

export function LineCommentEditor(props: LineCommentEditorProps) {
  const {
    value,
    selection,
    onInput,
    onCancel,
    onSubmit,
    placeholder = "Leave a comment...",
    rows = 3,
    autofocus,
    cancelLabel = "Cancel",
    submitLabel = "Comment",
    mention,
    ...rest
  } = props

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionItems, setMentionItems] = useState<string[]>([])
  const [activeMention, setActiveMention] = useState<string | null>(null)

  const currentMention = (): { query: string; start: number; end: number } | null => {
    const textarea = textareaRef.current
    if (!textarea || !mention) return null
    if (textarea.selectionStart !== textarea.selectionEnd) return null

    const end = textarea.selectionStart
    const match = textarea.value.slice(0, end).match(/@(\S*)$/)
    if (!match) return null
    return {
      query: match[1] ?? "",
      start: end - match[0].length,
      end,
    }
  }

  const syncMention = async () => {
    const item = currentMention()
    if (!item) {
      setMentionOpen(false)
      setMentionItems([])
      return
    }
    if (!mention) return
    setMentionOpen(true)
    const paths = await Promise.resolve(mention.items(item.query))
    const filtered = paths.filter((p) => p.toLowerCase().includes(item.query.toLowerCase())).slice(0, 10)
    setMentionItems(filtered)
    setActiveMention(filtered[0] ?? null)
  }

  const selectMention = (item: { path: string } | string | undefined) => {
    if (!item) return
    const path = typeof item === "string" ? item : item.path
    const textarea = textareaRef.current
    const query = currentMention()
    if (!textarea || !query) return

    const newValue = `${textarea.value.slice(0, query.start)}@${path} ${textarea.value.slice(query.end)}`
    const cursor = query.start + path.length + 2

    onInput(newValue)
    setMentionOpen(false)

    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(cursor, cursor)
    })
  }

  const focus = () => textareaRef.current?.focus()

  useEffect(() => {
    if (autofocus === false) return
    requestAnimationFrame(focus)
  }, [autofocus])

  const submit = () => {
    const v = value.trim()
    if (!v) return
    onSubmit(v)
  }

  const canSubmit = value.trim().length > 0

  return (
    <LineCommentAnchor
      {...rest}
      open={true}
      variant="editor"
      hideButton={props.inline}
      onClick={() => focus() as unknown as (e: ReactMouseEvent<HTMLButtonElement>) => void}
    >
      <div data-slot="line-comment-editor">
        <textarea
          ref={textareaRef}
          data-slot="line-comment-textarea"
          rows={rows}
          placeholder={placeholder}
          value={value}
          onChange={(e) => {
            onInput(e.target.value)
            syncMention()
          }}
          onClick={() => syncMention()}
          onSelect={() => syncMention()}
          onKeyDown={(e) => {
            const event = e
            if (event.key === "Escape") {
              if (mentionOpen) {
                event.preventDefault()
                setMentionOpen(false)
                return
              }
              event.preventDefault()
              event.currentTarget.blur()
              onCancel()
              return
            }
            if (event.key === "Tab" && mentionOpen && mentionItems.length > 0) {
              event.preventDefault()
              selectMention(activeMention ?? mentionItems[0])
              return
            }
            if (
              mentionOpen &&
              mentionItems.length > 0 &&
              (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Enter")
            ) {
              event.preventDefault()
              const idx = mentionItems.indexOf(activeMention ?? "")
              const nextIdx =
                event.key === "ArrowDown"
                  ? (idx + 1) % mentionItems.length
                  : (idx - 1 + mentionItems.length) % mentionItems.length
              setActiveMention(mentionItems[nextIdx])
              return
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              submit()
            }
          }}
        />
        {mentionOpen && mentionItems.length > 0 && (
          <div data-slot="line-comment-mention-list">
            {mentionItems.map((item) => (
              <button
                key={item}
                type="button"
                data-slot="line-comment-mention-item"
                data-active={activeMention === item ? "" : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActiveMention(item)}
                onClick={() => selectMention(item)}
                className="flex w-full items-center gap-2 px-2 py-1 text-left"
              >
                <div data-slot="line-comment-mention-path" className="flex-1 truncate text-xs">
                  <span data-slot="line-comment-mention-dir" className="text-muted-foreground">
                    {dirname(item)}/
                  </span>
                  <span data-slot="line-comment-mention-file" className="font-medium">
                    {basename(item)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
        <div data-slot="line-comment-actions" className="flex items-center justify-between gap-2">
          <div data-slot="line-comment-editor-label" className="text-xs text-muted-foreground">
            <span data-slot="line-comment-editor-label-prefix">Reply on </span>
            {selection}
            <span data-slot="line-comment-editor-label-suffix">:</span>
          </div>
          {props.inline ? (
            <div className="flex gap-2">
              <button
                type="button"
                data-slot="line-comment-action"
                data-variant="ghost"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation()
                  onCancel()
                }}
                className="rounded-md px-2 py-1 text-xs hover:bg-muted"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                data-slot="line-comment-action"
                data-variant="primary"
                disabled={!canSubmit}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation()
                  submit()
                }}
                className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {submitLabel}
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                type="button"
                data-slot="line-comment-action"
                data-variant="ghost"
                onClick={onCancel}
                className="rounded-md border px-3 py-1 text-xs hover:bg-muted"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                data-slot="line-comment-action"
                data-variant="primary"
                disabled={!canSubmit}
                onClick={submit}
                className="rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {submitLabel}
              </button>
            </div>
          )}
        </div>
      </div>
    </LineCommentAnchor>
  )
}

export type LineCommentSelection = { start: number; end: number; side?: "additions" | "deletions" }

export function formatSelectedLineLabel(selection: LineCommentSelection): ReactNode {
  if (selection.start === selection.end) return <>line {selection.start}</>
  return <>lines {selection.start}-{selection.end}</>
}