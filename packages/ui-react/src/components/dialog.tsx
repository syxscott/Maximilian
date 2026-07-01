import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { cn } from "../lib/utils"

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

export interface DialogContentProps
  extends Omit<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>, "title"> {
  title?: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  size?: "normal" | "large" | "x-large"
  fit?: boolean
  transition?: boolean
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(
  (
    { className, children, title, description, action, size = "normal", fit, transition, ...props },
    ref,
  ) => {
    return (
      <DialogPortal>
        <DialogOverlay />
        <div
          data-component="dialog"
          data-fit={fit ? true : undefined}
          data-size={size}
          data-transition={transition ? true : undefined}
        >
          <div data-slot="dialog-container">
            <DialogPrimitive.Content
              ref={ref}
              data-slot="dialog-content"
              data-no-header={!title && !action ? "" : undefined}
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
              {(title || action) && (
                <div data-slot="dialog-header">
                  {title && <DialogPrimitive.Title data-slot="dialog-title">{title}</DialogPrimitive.Title>}
                  {action ? (
                    action
                  ) : (
                    <DialogPrimitive.Close
                      data-slot="dialog-close-button"
                      aria-label="Close"
                      className="inline-flex items-center justify-center rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none"
                    >
                      <X className="h-4 w-4" />
                    </DialogPrimitive.Close>
                  )}
                </div>
              )}
              {description && (
                <DialogPrimitive.Description
                  data-slot="dialog-description"
                  style={{ marginLeft: "-4px" }}
                >
                  {description}
                </DialogPrimitive.Description>
              )}
              <div data-slot="dialog-body">{children}</div>
            </DialogPrimitive.Content>
          </div>
        </div>
      </DialogPortal>
    )
  },
)
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)} {...props} />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
