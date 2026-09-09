import {
  useEffect,
  useRef,
  type ReactNode,
  type KeyboardEvent,
  type HTMLAttributes,
} from "react"
import { cn } from "../lib/utils.js"

export function LineCommentV2OverflowIcon(props: HTMLAttributes<SVGSVGElement> & { width?: number; height?: number }) {
  const { width = 16, height = 16, ...rest } = props
  return (
    <svg
      {...rest}
      width={width}
      height={height}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M2.5 7.5H3.5V8.5H2.5V7.5Z" stroke="currentColor" />
      <path d="M7.5 7.5H8.5V8.5H7.5V7.5Z" stroke="currentColor" />
      <path d="M12.5 7.5H13.5V8.5H12.5V7.5Z" stroke="currentColor" />
    </svg>
  )
}

export interface LineCommentV2Props extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  comment: ReactNode
  selection: ReactNode
  actions?: ReactNode
}

export function LineCommentV2({ comment, selection, actions, className, ...rest }: LineCommentV2Props) {
  return (
    <div
      data-component="line-comment-v2"
      data-variant="display"
      className={cn(className)}
      {...rest}
    >
      <div data-slot="line-comment-v2-shell" className="flex items-start justify-between gap-3">
        <div data-slot="line-comment-v2-column" className="flex-1">
          <div data-slot="line-comment-v2-text">{comment}</div>
          <div data-slot="line-comment-v2-meta" className="text-xs text-muted-foreground">
            {selection}
          </div>
        </div>
        {actions && <div data-slot="line-comment-v2-tools">{actions}</div>}
      </div>
    </div>
  )
}

export interface LineCommentEditorV2Props
  extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "onInput" | "onSubmit"> {
  heading?: ReactNode | string
  value: string
  onInput: (value: string) => void
  onCancel: () => void
  onSubmit: (value: string) => void
  selection: ReactNode
  placeholder?: string
  rows?: number
  cancelLabel?: string
  submitLabel?: string
  autofocus?: boolean
}

export function LineCommentEditorV2({
  heading = "Comment",
  value,
  onInput,
  onCancel,
  onSubmit,
  selection,
  placeholder = "Add context for this change",
  rows = 3,
  cancelLabel = "Cancel",
  submitLabel = "Comment",
  autofocus,
  className,
  ...rest
}: LineCommentEditorV2Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const canSubmit = value.trim().length > 0

  const submit = () => {
    const v = value.trim()
    if (!v) return
    onSubmit(v)
  }

  useEffect(() => {
    if (autofocus === false) return
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [autofocus])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation()
    if (e.key === "Escape") {
      e.preventDefault()
      e.currentTarget.blur()
      onCancel()
      return
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div
      data-component="line-comment-v2"
      data-variant="editor"
      className={cn(className)}
      {...rest}
    >
      <div data-slot="line-comment-v2-shell" className="flex flex-col gap-3">
        <div data-slot="line-comment-v2-field" className="flex flex-col gap-1">
          <div data-slot="line-comment-v2-label" className="text-xs font-medium">
            {heading}
          </div>
          <textarea
            ref={textareaRef}
            data-slot="line-comment-v2-textarea"
            rows={rows}
            placeholder={placeholder}
            value={value}
            onChange={(e) => onInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div data-slot="line-comment-v2-footer" className="flex items-center justify-between gap-3">
          <div data-slot="line-comment-v2-footer-meta" className="text-xs text-muted-foreground">
            {selection}
          </div>
          <div data-slot="line-comment-v2-footer-actions" className="flex items-center gap-2">
            <button
              type="button"
              data-component="button"
              data-size="normal"
              data-variant="ghost"
              onClick={onCancel}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              data-component="button"
              data-size="normal"
              data-variant="primary"
              disabled={!canSubmit}
              onClick={submit}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {submitLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}