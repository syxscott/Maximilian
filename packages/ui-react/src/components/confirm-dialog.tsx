import * as React from "react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "./dialog"
import { Button } from "./button"
import { cn } from "../lib/utils"

export interface ConfirmDialogProps {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Visual emphasis of the confirm action. Defaults to "primary". */
  tone?: "primary" | "danger"
  /** Disable the confirm button. */
  disabled?: boolean
  /** Render as a Promise-returning imperative helper. */
  onConfirm?: () => void | Promise<void>
  onCancel?: () => void
  size?: "normal" | "large" | "x-large"
  className?: string
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  defaultOpen,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "primary",
  disabled,
  onConfirm,
  onCancel,
  size,
  className,
}) => {
  const isControlled = open !== undefined
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen ?? false)
  const currentOpen = isControlled ? open : internalOpen
  const [pending, setPending] = React.useState(false)

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setInternalOpen(next)
      onOpenChange?.(next)
    },
    [isControlled, onOpenChange],
  )

  const handleConfirm = React.useCallback(async () => {
    if (pending || disabled) return
    try {
      const result = onConfirm?.()
      if (result && typeof (result as Promise<void>).then === "function") {
        setPending(true)
        await result
      }
    } finally {
      setPending(false)
      setOpen(false)
    }
  }, [onConfirm, pending, disabled, setOpen])

  const handleCancel = React.useCallback(() => {
    onCancel?.()
    setOpen(false)
  }, [onCancel, setOpen])

  return (
    <Dialog open={currentOpen} onOpenChange={setOpen}>
      <DialogContent
        title={<DialogTitle>{title}</DialogTitle>}
        description={description ? <DialogDescription>{description}</DialogDescription> : undefined}
        size={size}
        className={className}
        action={
          <DialogFooter>
            <Button variant="ghost" onClick={handleCancel} disabled={pending}>
              {cancelLabel}
            </Button>
            <Button
              variant={tone === "danger" ? "primary" : "primary"}
              onClick={handleConfirm}
              disabled={disabled || pending}
              className={cn(tone === "danger" && "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
            >
              {pending ? "Working..." : confirmLabel}
            </Button>
          </DialogFooter>
        }
      >
        {description ? null : null}
      </DialogContent>
    </Dialog>
  )
}

/**
 * Imperative helper: open a confirm dialog as a Promise<boolean>.
 * Renders the dialog into a portal target. The returned promise resolves to
 * `true` on confirm and `false` on cancel.
 */
export interface ConfirmOptions {
  title: React.ReactNode
  description?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: "primary" | "danger"
  target?: HTMLElement | null
}

export function useConfirm() {
  const [state, setState] = React.useState<{
    open: boolean
    options: ConfirmOptions
    resolve?: (value: boolean) => void
  }>({ open: false, options: { title: "" } })

  const confirm = React.useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setState({ open: true, options, resolve })
    })
  }, [])

  const setOpen = (open: boolean) => {
    if (!open) {
      state.resolve?.(false)
      setState((s) => ({ ...s, open: false }))
    } else {
      setState((s) => ({ ...s, open: true }))
    }
  }

  const handleConfirm = () => {
    state.resolve?.(true)
    setState((s) => ({ ...s, open: false }))
  }

  const ConfirmPortal = (
    <ConfirmDialog
      open={state.open}
      onOpenChange={setOpen}
      onConfirm={handleConfirm}
      onCancel={() => state.resolve?.(false)}
      title={state.options.title}
      description={state.options.description}
      confirmLabel={state.options.confirmLabel}
      cancelLabel={state.options.cancelLabel}
      tone={state.options.tone}
    />
  )

  return { confirm, ConfirmPortal }
}
