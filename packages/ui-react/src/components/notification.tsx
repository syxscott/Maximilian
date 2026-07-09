import * as React from "react"
import * as ToastPrimitive from "@radix-ui/react-toast"
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from "lucide-react"
import { cn } from "../lib/utils.js"

export type NotificationTone = "default" | "success" | "info" | "warning" | "error"

export interface NotificationAction {
  label: string
  onClick: () => void
}

export interface NotificationOptions {
  id?: string
  title: React.ReactNode
  description?: React.ReactNode
  tone?: NotificationTone
  /** Auto-dismiss timeout in ms. Use `0` to make it persistent. */
  duration?: number
  action?: NotificationAction
  /** Show the close button. Defaults to true. */
  dismissible?: boolean
}

interface InternalNotification extends Required<Omit<NotificationOptions, "action" | "description">> {
  description?: React.ReactNode
  action?: NotificationAction
}

type Listener = (notifications: InternalNotification[]) => void

class NotificationStore {
  private items: InternalNotification[] = []
  private listeners: Set<Listener> = new Set()
  private counter = 0

  subscribe(listener: Listener) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = () => this.items

  getServerSnapshot = () => this.items

  private emit() {
    for (const l of this.listeners) l(this.items)
  }

  push(options: NotificationOptions): string {
    const id = options.id ?? `n-${++this.counter}-${Date.now()}`
    const next: InternalNotification = {
      id,
      title: options.title,
      description: options.description,
      tone: options.tone ?? "default",
      duration: options.duration ?? 4000,
      action: options.action,
      dismissible: options.dismissible ?? true,
    }
    this.items = [...this.items, next]
    this.emit()
    return id
  }

  dismiss(id: string) {
    const before = this.items.length
    this.items = this.items.filter((n) => n.id !== id)
    if (this.items.length !== before) this.emit()
  }

  clear() {
    if (this.items.length === 0) return
    this.items = []
    this.emit()
  }
}

const store = new NotificationStore()

function useNotifications() {
  return React.useSyncExternalStore(store.subscribe.bind(store), store.getSnapshot, store.getServerSnapshot)
}

const toneStyles: Record<NotificationTone, string> = {
  default: "border-border bg-background text-foreground",
  success: "border-green-500/30 bg-green-500/5 text-foreground",
  info: "border-blue-500/30 bg-blue-500/5 text-foreground",
  warning: "border-amber-500/30 bg-amber-500/5 text-foreground",
  error: "border-red-500/30 bg-red-500/5 text-foreground",
}

const toneIcon: Record<NotificationTone, React.ReactNode> = {
  default: null,
  success: <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden="true" />,
  info: <Info className="h-4 w-4 text-blue-600" aria-hidden="true" />,
  warning: <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden="true" />,
  error: <AlertCircle className="h-4 w-4 text-red-600" aria-hidden="true" />,
}

const NotificationItem: React.FC<{
  notification: InternalNotification
  onDismiss: (id: string) => void
}> = ({ notification, onDismiss }) => {
  return (
    <ToastPrimitive.Root
      data-component="notification"
      data-tone={notification.tone}
      duration={notification.duration}
      onOpenChange={(open) => {
        if (!open) onDismiss(notification.id)
      }}
      className={cn(
        "pointer-events-auto flex w-full items-start gap-3 rounded-md border p-3 shadow-lg backdrop-blur-sm",
        "data-[state=open]:animate-in data-[state=open]:slide-in-from-right-full data-[state=open]:fade-in-0",
        "data-[state=closed]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full",
        toneStyles[notification.tone],
      )}
    >
      {toneIcon[notification.tone] ? (
        <span className="mt-0.5 shrink-0">{toneIcon[notification.tone]}</span>
      ) : null}
      <div className="flex-1 min-w-0">
        <ToastPrimitive.Title className="text-sm font-medium text-foreground">
          {notification.title}
        </ToastPrimitive.Title>
        {notification.description ? (
          <ToastPrimitive.Description className="mt-0.5 text-xs text-muted-foreground">
            {notification.description}
          </ToastPrimitive.Description>
        ) : null}
        {notification.action ? (
          <ToastPrimitive.Action
            altText={notification.action.label}
            asChild
            onClick={(e) => {
              e.preventDefault()
              notification.action?.onClick()
              onDismiss(notification.id)
            }}
          >
            <button
              type="button"
              className="mt-2 text-xs font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
            >
              {notification.action.label}
            </button>
          </ToastPrimitive.Action>
        ) : null}
      </div>
      {notification.dismissible ? (
        <ToastPrimitive.Close
          aria-label="Dismiss"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onDismiss(notification.id)}
        >
          <X className="h-3.5 w-3.5" />
        </ToastPrimitive.Close>
      ) : null}
    </ToastPrimitive.Root>
  )
}

export interface NotificationViewportProps
  extends Omit<React.ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>, "children"> {
  position?: "top-right" | "top-left" | "bottom-right" | "bottom-left" | "top-center" | "bottom-center"
}

const positionClasses: Record<NonNullable<NotificationViewportProps["position"]>, string> = {
  "top-right": "top-4 right-4 flex-col",
  "top-left": "top-4 left-4 flex-col",
  "bottom-right": "bottom-4 right-4 flex-col-reverse",
  "bottom-left": "bottom-4 left-4 flex-col-reverse",
  "top-center": "top-4 left-1/2 -translate-x-1/2 flex-col",
  "bottom-center": "bottom-4 left-1/2 -translate-x-1/2 flex-col-reverse",
}

export const NotificationViewport: React.FC<NotificationViewportProps> = ({
  position = "bottom-right",
  className,
  ...rest
}) => {
  const notifications = useNotifications()

  return (
    <ToastPrimitive.Provider swipeDirection="right" duration={4000}>
      {notifications.map((n) => (
        <NotificationItem key={n.id} notification={n} onDismiss={store.dismiss.bind(store)} />
      ))}
      <ToastPrimitive.Viewport
        data-component="notification-viewport"
        data-position={position}
        className={cn(
          "pointer-events-none fixed z-[100] flex w-[360px] max-w-[calc(100vw-2rem)] gap-2",
          positionClasses[position],
          className,
        )}
        {...rest}
      />
    </ToastPrimitive.Provider>
  )
}

/**
 * Imperative API: `notify.success({ ... })`, `notify.error({ ... })`, etc.
 * Place a single `<NotificationViewport />` near the root of your tree.
 */
export const notify = {
  push: (options: NotificationOptions) => store.push(options),
  success: (options: Omit<NotificationOptions, "tone">) => store.push({ ...options, tone: "success" }),
  info: (options: Omit<NotificationOptions, "tone">) => store.push({ ...options, tone: "info" }),
  warning: (options: Omit<NotificationOptions, "tone">) => store.push({ ...options, tone: "warning" }),
  error: (options: Omit<NotificationOptions, "tone">) => store.push({ ...options, tone: "error" }),
  dismiss: (id: string) => store.dismiss(id),
  clear: () => store.clear(),
}
