import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { cn } from "../../lib/utils"

export interface DialogProps {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  modal?: boolean
  title?: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  size?: "normal" | "large" | "x-large"
  variant?: "default" | "settings"
  className?: string
  fit?: boolean
  children?: React.ReactNode
}

export const DialogFooter: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ children, ...props }) => (
  <div data-slot="dialog-footer" {...props}>
    {children}
  </div>
)
DialogFooter.displayName = "DialogFooter"

const CloseIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      d="M12.4446 3.55469L3.55566 12.4436M3.55566 3.55469L12.4446 12.4436"
      stroke="#808080"
      strokeLinejoin="round"
    />
  </svg>
)

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    data-slot="dialog-overlay"
    className={cn(className)}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Content
    ref={ref}
    data-slot="dialog-content"
    className={cn(className)}
    onOpenAutoFocus={(e) => {
      const target = e.currentTarget as HTMLElement | null
      const autofocusEl = target?.querySelector("[autofocus]") as HTMLElement | null
      if (autofocusEl) {
        e.preventDefault()
        autofocusEl.focus()
      }
    }}
    {...props}
  >
    {children}
  </DialogPrimitive.Content>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

export const Dialog: React.FC<DialogProps> = ({
  title,
  description,
  action,
  size = "normal",
  variant,
  className,
  fit,
  children,
  open,
  defaultOpen,
  onOpenChange,
  modal,
}) => {
  const hasHeader = !!title || !!action
  return (
    <DialogPrimitive.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      modal={modal}
    >
      <DialogPrimitive.Portal>
        <DialogOverlay />
        <div
          data-component="dialog-v2"
          data-variant={variant === "settings" ? "settings" : undefined}
          data-fit={fit ? "" : undefined}
          data-size={size}
        >
          <div data-slot="dialog-container">
            <DialogContent
              data-no-header={!hasHeader ? "" : undefined}
              className={cn(className)}
            >
              {hasHeader ? (
                <div data-slot="dialog-header">
                  <div data-slot="dialog-title-group">
                    {title ? (
                      <DialogPrimitive.Title data-slot="dialog-title">
                        {title}
                      </DialogPrimitive.Title>
                    ) : null}
                    {description ? (
                      <DialogPrimitive.Description data-slot="dialog-description">
                        {description}
                      </DialogPrimitive.Description>
                    ) : null}
                  </div>
                  {action}
                  {!action ? (
                    <DialogPrimitive.Close
                      data-slot="dialog-close-button"
                      aria-label="Close"
                    >
                      <CloseIcon />
                    </DialogPrimitive.Close>
                  ) : null}
                </div>
              ) : null}
              <div data-slot="dialog-body">{children}</div>
            </DialogContent>
          </div>
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
Dialog.displayName = "Dialog"

export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close
export const DialogPortal = DialogPrimitive.Portal
export const DialogTitle = DialogPrimitive.Title
export const DialogDescription = DialogPrimitive.Description
