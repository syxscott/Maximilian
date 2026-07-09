import * as React from "react"
import { Info } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "./dialog.js"
import { Button } from "./button.js"
import { cn } from "../lib/utils.js"

export interface InfoDialogProps {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  /** Optional rich content (rendered inside the dialog body). */
  children?: React.ReactNode
  /** Label for the close button. Defaults to "OK". */
  closeLabel?: string
  /** Optional secondary action. */
  secondaryAction?: React.ReactNode
  size?: "normal" | "large" | "x-large"
  className?: string
  /** Hide the close button. */
  hideCloseButton?: boolean
}

export const InfoDialog: React.FC<InfoDialogProps> = ({
  open,
  defaultOpen,
  onOpenChange,
  title,
  description,
  children,
  closeLabel = "OK",
  secondaryAction,
  size,
  className,
  hideCloseButton,
}) => {
  const isControlled = open !== undefined
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen ?? false)
  const currentOpen = isControlled ? open : internalOpen

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setInternalOpen(next)
      onOpenChange?.(next)
    },
    [isControlled, onOpenChange],
  )

  return (
    <Dialog open={currentOpen} onOpenChange={setOpen}>
      <DialogContent
        title={
          <div className="flex items-center gap-2">
            <Info className="h-5 w-5 text-primary" aria-hidden="true" />
            <DialogTitle>{title}</DialogTitle>
          </div>
        }
        description={description ? <DialogDescription>{description}</DialogDescription> : undefined}
        size={size}
        className={className}
        action={
          hideCloseButton ? null : (
            <DialogFooter className={cn("flex flex-row items-center justify-end gap-2")}>
              {secondaryAction}
              <Button variant="primary" onClick={() => setOpen(false)}>
                {closeLabel}
              </Button>
            </DialogFooter>
          )
        }
      >
        {children ? <div data-slot="info-dialog-body">{children}</div> : null}
      </DialogContent>
    </Dialog>
  )
}
