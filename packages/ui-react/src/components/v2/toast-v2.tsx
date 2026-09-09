import * as React from "react"
import * as ToastPrimitive from "@radix-ui/react-toast"
import { cn } from "../../lib/utils.js"
import { ButtonV2 } from "./button-v2.js"

export interface ToastV2RegionProps
  extends React.ComponentPropsWithoutRef<typeof ToastPrimitive.Provider> {}

export const ToastV2Region: React.FC<ToastV2RegionProps> = (props) => (
  <ToastPrimitive.Provider swipeDirection="right" {...props}>
    {props.children}
  </ToastPrimitive.Provider>
)
ToastV2Region.displayName = "ToastV2Region"

export interface ToastV2RootComponentProps
  extends React.ComponentPropsWithoutRef<typeof ToastPrimitive.Root> {
  className?: string
  children?: React.ReactNode
}

export const ToastV2Root = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Root>,
  ToastV2RootComponentProps
>(({ className, children, ...props }, ref) => (
  <ToastPrimitive.Root
    ref={ref}
    data-component="toast-v2"
    className={cn(className)}
    {...props}
  >
    {children}
  </ToastPrimitive.Root>
))
ToastV2Root.displayName = "ToastV2Root"

export const ToastV2Icon: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  children,
  ...props
}) => (
  <div data-slot="toast-v2-icon" className={cn(className)} {...props}>
    {children}
  </div>
)
ToastV2Icon.displayName = "ToastV2Icon"

export const ToastV2Content: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  children,
  ...props
}) => (
  <div data-slot="toast-v2-content" className={cn(className)} {...props}>
    {children}
  </div>
)
ToastV2Content.displayName = "ToastV2Content"

export const ToastV2Title = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Title
    ref={ref}
    data-slot="toast-v2-title"
    className={cn(className)}
    {...props}
  />
))
ToastV2Title.displayName = "ToastV2Title"

export const ToastV2Description = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Description
    ref={ref}
    data-slot="toast-v2-description"
    className={cn(className)}
    {...props}
  />
))
ToastV2Description.displayName = "ToastV2Description"

export const ToastV2Actions: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  children,
  ...props
}) => (
  <div data-slot="toast-v2-actions" className={cn(className)} {...props}>
    {children}
  </div>
)
ToastV2Actions.displayName = "ToastV2Actions"

export const ToastV2CloseButton = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Close
    ref={ref}
    data-slot="toast-v2-close-button"
    aria-label="Dismiss"
    className={cn(className)}
    {...props}
  >
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M4.25 11.75L11.75 4.25" stroke="currentColor" />
      <path d="M11.75 11.75L4.25 4.25" stroke="currentColor" />
    </svg>
  </ToastPrimitive.Close>
))
ToastV2CloseButton.displayName = "ToastV2CloseButton"

export const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Viewport
    ref={ref}
    data-slot="toast-v2-list"
    data-component="toast-v2-region"
    className={cn(className)}
    {...props}
  />
))
ToastViewport.displayName = "ToastViewport"

export const ToastV2 = Object.assign(ToastV2Root, {
  Region: ToastV2Region,
  Viewport: ToastViewport,
  Icon: ToastV2Icon,
  Content: ToastV2Content,
  Title: ToastV2Title,
  Description: ToastV2Description,
  Actions: ToastV2Actions,
  CloseButton: ToastV2CloseButton,
})

// ------------------------------------------------------------
// Imperative toast API (mirrors Kobalte's toaster.show).
// ------------------------------------------------------------

type ToasterEntry = {
  id: string
  opts: ToastV2Options
  open: boolean
}

type ToasterState = {
  toasts: ToasterEntry[]
}

type ToasterListener = (state: ToasterState) => void

class ToasterStore {
  private state: ToasterState = { toasts: [] }
  private listeners = new Set<ToasterListener>()

  getState = (): ToasterState => this.state
  subscribe = (l: ToasterListener) => {
    this.listeners.add(l)
    return () => {
      this.listeners.delete(l)
    }
  }

  show = (opts: ToastV2Options): string => {
    const id = `toast-v2-${Math.random().toString(36).slice(2, 10)}`
    this.state = {
      toasts: [...this.state.toasts, { id, opts, open: true }],
    }
    this.emit()
    return id
  }

  dismiss = (id: string) => {
    this.state = {
      toasts: this.state.toasts.map((t) => (t.id === id ? { ...t, open: false } : t)),
    }
    this.emit()
  }

  remove = (id: string) => {
    this.state = { toasts: this.state.toasts.filter((t) => t.id !== id) }
    this.emit()
  }

  private emit() {
    for (const l of this.listeners) l(this.state)
  }
}

export const toasterV2 = new ToasterStore()

export interface ToastV2Action {
  label: string
  variant?: "primary" | "secondary"
  onClick: "dismiss" | (() => void)
}

export interface ToastV2Options {
  title?: string
  description?: string
  icon?: React.ReactNode
  duration?: number
  persistent?: boolean
  actions?: ToastV2Action[]
}

export function showToastV2(options: ToastV2Options | string): string {
  const opts: ToastV2Options =
    typeof options === "string" ? { description: options } : options
  return toasterV2.show(opts)
}

export function dismissToastV2(id: string) {
  toasterV2.dismiss(id)
}

/**
 * Mount this component once near the root of your app to render the toaster
 * viewport. It subscribes to the imperative `toasterV2.show` API.
 */
export const ToasterV2Mount: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const [state, setState] = React.useState<ToasterState>(toasterV2.getState())

  React.useEffect(() => toasterV2.subscribe(setState), [])

  return (
    <ToastV2Region duration={5000} swipeDirection="right">
      {state.toasts.map((entry) => {
        const opts = entry.opts
        return (
          <ToastV2
            key={entry.id}
            open={entry.open}
            onOpenChange={(open: boolean) => {
              if (!open) toasterV2.dismiss(entry.id)
            }}
            duration={opts.persistent ? Number.POSITIVE_INFINITY : opts.duration}
            onSwipeEnd={() => toasterV2.dismiss(entry.id)}
          >
            <div data-slot="toast-v2-header">
              {opts.icon ? <ToastV2Icon>{opts.icon}</ToastV2Icon> : null}
              <ToastV2Content>
                {opts.title ? <ToastV2Title>{opts.title}</ToastV2Title> : null}
                {opts.description ? (
                  <ToastV2Description>{opts.description}</ToastV2Description>
                ) : null}
              </ToastV2Content>
              <ToastV2CloseButton onClick={() => toasterV2.dismiss(entry.id)} />
            </div>
            {opts.actions && opts.actions.length > 0 ? (
              <ToastV2Actions>
                {opts.actions.map((action, i) => (
                  <ButtonV2
                    key={`${action.label}-${i}`}
                    variant={action.variant === "secondary" ? "ghost" : "neutral"}
                    size="small"
                    data-action-variant={action.variant ?? "primary"}
                    onClick={() => {
                      if (typeof action.onClick === "function") {
                        action.onClick()
                      }
                      toasterV2.dismiss(entry.id)
                    }}
                  >
                    {action.label}
                  </ButtonV2>
                ))}
              </ToastV2Actions>
            ) : null}
          </ToastV2>
        )
      })}
      <ToastViewport />
      {children}
    </ToastV2Region>
  )
}
ToasterV2Mount.displayName = "ToasterV2Mount"

export interface ToastV2PromiseOptions<T, U = unknown> {
  loading?: React.ReactNode
  success?: (data: T) => React.ReactNode
  error?: (error: U) => React.ReactNode
}
