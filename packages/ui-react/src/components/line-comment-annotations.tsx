import {
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
  type FocusEvent as ReactFocusEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import { cn } from "../lib/utils"
import {
  LineComment,
  LineCommentEditor,
  type LineCommentEditorProps,
} from "./line-comment"

export type LineCommentSelection = { start: number; end: number; side?: "additions" | "deletions" }

export type LineCommentAnnotationMeta<T> =
  | { kind: "comment"; key: string; comment: T }
  | { kind: "draft"; key: string; range: LineCommentSelection }

export type LineCommentAnnotation<T> = {
  lineNumber: number
  side?: "additions" | "deletions"
  metadata: LineCommentAnnotationMeta<T>
}

export type LineCommentShape = {
  id: string
  selection: LineCommentSelection
  comment: string
}

export type CommentProps = {
  id?: string
  open: boolean
  comment: ReactNode
  selection: ReactNode
  actions?: ReactNode
  editor?: DraftProps
  onClick?: (e: ReactMouseEvent<HTMLButtonElement>) => void
  onMouseEnter?: (e: ReactMouseEvent<HTMLButtonElement>) => void
}

export type DraftProps = {
  value: string
  selection: ReactNode
  mention?: LineCommentEditorProps["mention"]
  onInput: (value: string) => void
  onCancel: () => void
  onSubmit: (value: string) => void
  onPopoverFocusOut?: (e: ReactFocusEvent<HTMLDivElement>) => void
  cancelLabel?: string
  submitLabel?: string
}

type NodeEntry = {
  host: HTMLDivElement
  setMeta: (meta: LineCommentAnnotationMeta<unknown>) => void
  dispose: () => void
}

export interface LineCommentAnnotationRenderer {
  render: <A extends { metadata: LineCommentAnnotationMeta<unknown> }>(annotation: A) => HTMLElement | undefined
  reconcile: <A extends { metadata: LineCommentAnnotationMeta<unknown> }>(annotations: A[]) => void
  cleanup: () => void
}

export function createLineCommentAnnotationRenderer<T>(props: {
  renderComment: (comment: T) => CommentProps
  renderDraft: (range: LineCommentSelection) => DraftProps
}): LineCommentAnnotationRenderer {
  const nodes = new Map<string, NodeEntry>()

  const mount = (meta: LineCommentAnnotationMeta<T>): NodeEntry | null => {
    if (typeof document === "undefined") return null
    const host = document.createElement("div")
    host.setAttribute("data-prevent-autofocus", "")

    const setMeta = (m: LineCommentAnnotationMeta<T>) => {
      renderInto(host, m, props.renderComment, props.renderDraft)
    }

    renderInto(host, meta, props.renderComment, props.renderDraft)
    nodes.set(meta.key, {
      host,
      setMeta: setMeta as unknown as (meta: LineCommentAnnotationMeta<unknown>) => void,
      dispose: () => {
        try {
          document.body.removeChild(host)
        } catch {
          // ignore
        }
      },
    })
    return nodes.get(meta.key) ?? null
  }

  const render = <A extends { metadata: LineCommentAnnotationMeta<unknown> }>(
    annotation: A,
  ): HTMLElement | undefined => {
    const meta = annotation.metadata as unknown as LineCommentAnnotationMeta<T>
    let node = nodes.get(meta.key)
    if (!node) {
      const created = mount(meta)
      if (!created) return undefined
      node = created
    }
    node.setMeta(meta)
    return node.host
  }

  const reconcile = <A extends { metadata: LineCommentAnnotationMeta<unknown> }>(
    annotations: A[],
  ) => {
    const next = new Set(annotations.map((a) => a.metadata.key))
    for (const [key, node] of nodes) {
      if (next.has(key)) continue
      node.dispose()
      nodes.delete(key)
    }
  }

  const cleanup = () => {
    for (const [, node] of nodes) node.dispose()
    nodes.clear()
  }

  return { render, reconcile, cleanup }
}

function renderInto<T>(
  host: HTMLDivElement,
  meta: LineCommentAnnotationMeta<T>,
  renderComment: (comment: T) => CommentProps,
  renderDraft: (range: LineCommentSelection) => DraftProps,
) {
  const root = createPortal(
    meta.kind === "comment" ? (
      (() => {
        const view = renderComment(meta.comment)
        return view.editor ? (
          <LineCommentEditor
            inline
            id={view.id}
            value={view.editor.value}
            selection={view.editor.selection as ReactNode}
            onInput={view.editor.onInput}
            onCancel={view.editor.onCancel}
            onSubmit={view.editor.onSubmit}
            onPopoverFocusOut={view.editor.onPopoverFocusOut}
            cancelLabel={view.editor.cancelLabel}
            submitLabel={view.editor.submitLabel}
            mention={view.editor.mention}
          />
        ) : (
          <LineComment
            inline
            id={view.id}
            open={view.open}
            comment={view.comment}
            selection={view.selection as ReactNode}
            actions={view.actions}
            onClick={view.onClick}
            onMouseEnter={view.onMouseEnter}
          />
        )
      })()
    ) : (
      (() => {
        const view = renderDraft(meta.range)
        return (
          <LineCommentEditor
            inline
            value={view.value}
            selection={view.selection as ReactNode}
            onInput={view.onInput}
            onCancel={view.onCancel}
            onSubmit={view.onSubmit}
            onPopoverFocusOut={view.onPopoverFocusOut}
            cancelLabel={view.cancelLabel}
            submitLabel={view.submitLabel}
            mention={view.mention}
          />
        )
      })()
    ),
    host,
  )
  return root
}

export interface LineCommentAnnotationsProps<T> {
  comments: T[]
  getCommentId: (comment: T) => string
  getCommentSelection: (comment: T) => LineCommentSelection
  draftRange: LineCommentSelection | null
  draftKey: string
  getSide?: (range: LineCommentSelection) => "additions" | "deletions"
}

export function useLineCommentAnnotations<T>(
  props: LineCommentAnnotationsProps<T>,
): LineCommentAnnotation<T>[] {
  const { comments, draftRange, draftKey, getCommentId, getCommentSelection, getSide } = props
  return useMemo(() => {
    const line = (range: LineCommentSelection) => Math.max(range.start, range.end)
    const list: LineCommentAnnotation<T>[] = comments.map((comment) => {
      const range = getCommentSelection(comment)
      const entry: LineCommentAnnotation<T> = {
        lineNumber: line(range),
        metadata: {
          kind: "comment",
          key: `comment:${getCommentId(comment)}`,
          comment,
        },
      }
      if (getSide) entry.side = getSide(range)
      return entry
    })

    if (!draftRange) return list

    const draft: LineCommentAnnotation<T> = {
      lineNumber: line(draftRange),
      metadata: {
        kind: "draft",
        key: `draft:${draftKey}`,
        range: draftRange,
      },
    }
    if (getSide) draft.side = getSide(draftRange)
    return [...list, draft]
  }, [comments, draftRange, draftKey, getCommentId, getCommentSelection, getSide])
}

export interface LineCommentControllerProps<T extends LineCommentShape> {
  comments: T[]
  setComments: (next: T[]) => void
  draftKey: string
  label: string
  mention?: LineCommentEditorProps["mention"]
  onSubmit: (input: { comment: string; selection: LineCommentSelection }) => void
  onUpdate?: (input: { id: string; comment: string; selection: LineCommentSelection }) => void
  onDelete?: (comment: T) => void
  renderCommentActions?: (comment: T, controls: { edit: () => void; remove: () => void }) => ReactNode
  editSubmitLabel?: string
  cancelDraftOnCommentToggle?: boolean
  clearSelectionOnSelectionEndNull?: boolean
}

export interface LineCommentControllerApi {
  openedId: string | null
  setOpenedId: (id: string | null) => void
  selected: LineCommentSelection | null
  setSelected: (range: LineCommentSelection | null) => void
  commenting: LineCommentSelection | null
  setCommenting: (range: LineCommentSelection | null) => void
  draft: string
  setDraft: (v: string) => void
  editingId: string | null
  setEditingId: (id: string | null) => void
  isOpen: (id: string) => boolean
  isEditing: (id: string) => boolean
  openComment: (id: string, range: LineCommentSelection) => void
  toggleComment: (id: string, range: LineCommentSelection) => void
  openDraft: (range: LineCommentSelection) => void
  cancelDraft: () => void
  openEditor: (id: string, range: LineCommentSelection, value: string) => void
  finishSelection: (range: LineCommentSelection | null) => void
  reset: () => void
  select: (range: LineCommentSelection | null) => void
}

export function useLineCommentController<T extends LineCommentShape>(
  props: LineCommentControllerProps<T>,
): LineCommentControllerApi {
  const [openedId, setOpenedId] = useState<string | null>(null)
  const [selected, setSelected] = useState<LineCommentSelection | null>(null)
  const [commenting, setCommenting] = useState<LineCommentSelection | null>(null)
  const [draft, setDraft] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)

  const cloneRange = (range: LineCommentSelection | null): LineCommentSelection | null =>
    range ? { start: range.start, end: range.end, side: range.side } : null

  const cancelDraft = useCallback(() => {
    setDraft("")
    setEditingId(null)
    setCommenting(null)
  }, [])

  const openComment = useCallback(
    (id: string, range: LineCommentSelection) => {
      if (props.cancelDraftOnCommentToggle) cancelDraft()
      setOpenedId(id)
      setSelected(cloneRange(range))
    },
    [props.cancelDraftOnCommentToggle, cancelDraft],
  )

  const toggleComment = useCallback(
    (id: string, range: LineCommentSelection) => {
      if (props.cancelDraftOnCommentToggle) cancelDraft()
      setOpenedId((prev) => (prev === id ? null : id))
      setSelected(cloneRange(range))
    },
    [props.cancelDraftOnCommentToggle, cancelDraft],
  )

  const openDraft = useCallback(
    (range: LineCommentSelection) => {
      const next = cloneRange(range)
      setDraft("")
      setEditingId(null)
      setOpenedId(null)
      setSelected(next)
      setCommenting(next)
    },
    [],
  )

  const openEditor = useCallback(
    (id: string, range: LineCommentSelection, value: string) => {
      setOpenedId(null)
      setSelected(cloneRange(range))
      setCommenting(null)
      setEditingId(id)
      setDraft(value)
    },
    [],
  )

  const finishSelection = useCallback(
    (range: LineCommentSelection | null) => {
      setOpenedId(null)
      if (range) setSelected(cloneRange(range))
      cancelDraft()
    },
    [cancelDraft],
  )

  const reset = useCallback(() => {
    setDraft("")
    setEditingId(null)
    setOpenedId(null)
    setSelected(null)
    setCommenting(null)
  }, [])

  const isOpen = useCallback((id: string) => openedId === id || editingId === id, [
    openedId,
    editingId,
  ])

  const isEditing = useCallback((id: string) => editingId === id, [editingId])

  return {
    openedId,
    setOpenedId,
    selected,
    setSelected,
    commenting,
    setCommenting,
    draft,
    setDraft,
    editingId,
    setEditingId,
    isOpen,
    isEditing,
    openComment,
    toggleComment,
    openDraft,
    cancelDraft,
    openEditor,
    finishSelection,
    reset,
    select: (range) => setSelected(cloneRange(range)),
  }
}

export interface UseManagedAnnotationRendererOptions<T> {
  annotations: LineCommentAnnotation<T>[]
  renderComment: (comment: T) => CommentProps
  renderDraft: (range: LineCommentSelection) => DraftProps
}

export function useManagedAnnotationRenderer<T>(
  options: UseManagedAnnotationRendererOptions<T>,
): {
  renderAnnotation: (annotation: LineCommentAnnotation<T>) => HTMLElement | undefined
} {
  const rendererRef = useRef<LineCommentAnnotationRenderer | null>(null)

  if (!rendererRef.current) {
    rendererRef.current = createLineCommentAnnotationRenderer<T>({
      renderComment: options.renderComment,
      renderDraft: options.renderDraft,
    })
  }

  useEffect(() => {
    rendererRef.current?.reconcile(options.annotations)
  }, [options.annotations])

  useEffect(() => {
    return () => {
      rendererRef.current?.cleanup()
    }
  }, [])

  return {
    renderAnnotation: (annotation) =>
      rendererRef.current?.render(annotation as unknown as { metadata: LineCommentAnnotationMeta<unknown> }),
  }
}