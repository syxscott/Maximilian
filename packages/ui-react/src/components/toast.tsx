import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import * as ToastPrimitive from "@radix-ui/react-toast"
import { cn } from "../lib/utils.js"

export type ToastVariant = "default" | "success" | "warning" | "error" | "info"

export interface ToastOptions {
  id?: string
  title?: ReactNode
  description?: ReactNode
  action?: ReactNode
  variant?: ToastVariant
  duration?: number
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

interface ToastItem extends Required<Omit<ToastOptions, "id" | "onOpenChange">> {
  id: string
  onOpenChange?: (open: boolean) => void
}

export interface ToastContextValue {
  toasts: ToastItem[]
  toast: (options: ToastOptions) => string
  dismiss: (id: string) => void
  update: (id: string, options: Partial<ToastOptions>) => void
  clear: () => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

let idCounter = 0
function generateId() {
  idCounter += 1
  return `toast-${Date.now().toString(36)}-${idCounter}`
}

const DEFAULT_DURATION = 5000

export interface ToastProviderProps {
  children: ReactNode
  duration?: number
  swipeDirection?: "right" | "left" | "up" | "down"
}

export function ToastProvider({
  children,
  duration = DEFAULT_DURATION,
  swipeDirection = "right",
}: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const clearTimer = useCallback((id: string) => {
    const timer = timersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
  }, [])

  const setTimer = useCallback(
    (id: string, ms: number) => {
      clearTimer(id)
      if (ms <= 0) return
      const timer = setTimeout(() => {
        timersRef.current.delete(id)
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, ms)
      timersRef.current.set(id, timer)
    },
    [clearTimer],
  )

  const dismiss = useCallback(
    (id: string) => {
      clearTimer(id)
      setToasts((prev) => prev.filter((t) => t.id !== id))
    },
    [clearTimer],
  )

  const toast = useCallback(
    (options: ToastOptions): string => {
      const id = options.id ?? generateId()
      const item: ToastItem = {
        id,
        title: options.title ?? null,
        description: options.description ?? null,
        action: options.action ?? null,
        variant: options.variant ?? "default",
        duration: options.duration ?? duration,
        open: options.open ?? true,
        onOpenChange: options.onOpenChange,
      }
      setToasts((prev) => {
        const idx = prev.findIndex((t) => t.id === id)
        if (idx >= 0) {
          const next = prev.slice()
          next[idx] = item
          return next
        }
        return [...prev, item]
      })
      setTimer(id, item.duration)
      return id
    },
    [duration, setTimer],
  )

  const update = useCallback(
    (id: string, options: Partial<ToastOptions>) => {
      setToasts((prev) =>
        prev.map((t) =>
          t.id === id
            ? {
                ...t,
                ...options,
                title: options.title ?? t.title,
                description: options.description ?? t.description,
                action: options.action ?? t.action,
                variant: options.variant ?? t.variant,
                duration: options.duration ?? t.duration,
                onOpenChange: options.onOpenChange ?? t.onOpenChange,
              }
            : t,
        ),
      )
      if (options.duration !== undefined) {
        setTimer(id, options.duration)
      }
    },
    [setTimer],
  )

  const clear = useCallback(() => {
    timersRef.current.forEach((t) => clearTimeout(t))
    timersRef.current.clear()
    setToasts([])
  }, [])

  useEffect(() => {
    return () => {
      timersRef.current.forEach((t) => clearTimeout(t))
      timersRef.current.clear()
    }
  }, [])

  const value = useMemo<ToastContextValue>(
    () => ({ toasts, toast, dismiss, update, clear }),
    [toasts, toast, dismiss, update, clear],
  )

  return (
    <ToastContext.Provider value={value}>
      <ToastPrimitive.Provider duration={duration} swipeDirection={swipeDirection}>
        {children}
        {toasts.map((t) => (
          <ToastItemView
            key={t.id}
            item={t}
            onOpenChange={(open) => {
              if (!open) {
                dismiss(t.id)
                t.onOpenChange?.(false)
              } else {
                t.onOpenChange?.(true)
              }
            }}
            onAction={() => setTimer(t.id, t.duration)}
          />
        ))}
        <ToastPrimitive.Viewport
          data-slot="toast-viewport"
          className={cn(
            "fixed bottom-0 right-0 z-[100] flex max-h-screen w-full flex-col-reverse gap-2 p-4",
            "sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]",
          )}
        />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  )
}

interface ToastItemViewProps {
  item: ToastItem
  onOpenChange: (open: boolean) => void
  onAction: () => void
}

function ToastItemView({ item, onOpenChange, onAction }: ToastItemViewProps) {
  return (
    <ToastPrimitive.Root
      data-component="toast"
      data-variant={item.variant}
      open={item.open}
      onOpenChange={onOpenChange}
      duration={item.duration}
      className={cn(
        "group pointer-events-auto relative flex w-full items-center justify-between gap-2 overflow-hidden rounded-md border p-4 shadow-lg",
        "data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)]",
        "data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none",
        "data-[state=open]:animate-in data-[state=open]:slide-in-from-right-full",
        "data-[state=closed]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full",
        {
          "border-border bg-background text-foreground": item.variant === "default",
          "border-green-600/30 bg-green-50 text-green-900 dark:bg-green-950/30 dark:text-green-100":
            item.variant === "success",
          "border-yellow-600/30 bg-yellow-50 text-yellow-900 dark:bg-yellow-950/30 dark:text-yellow-100":
            item.variant === "warning",
          "border-destructive/30 bg-destructive/5 text-destructive": item.variant === "error",
          "border-blue-600/30 bg-blue-50 text-blue-900 dark:bg-blue-950/30 dark:text-blue-100":
            item.variant === "info",
        },
      )}
    >
      <div data-slot="toast-content" className="flex-1">
        {item.title && (
          <ToastPrimitive.Title data-slot="toast-title" className="text-sm font-semibold">
            {item.title}
          </ToastPrimitive.Title>
        )}
        {item.description && (
          <ToastPrimitive.Description
            data-slot="toast-description"
            className="mt-1 text-sm opacity-90"
          >
            {item.description}
          </ToastPrimitive.Description>
        )}
      </div>
      {item.action && (
        <ToastPrimitive.Action
          data-slot="toast-action"
          altText={typeof item.action === "string" ? item.action : "Action"}
          onClick={onAction}
          asChild
        >
          {item.action as ReactNode}
        </ToastPrimitive.Action>
      )}
      <ToastPrimitive.Close
        data-slot="toast-close"
        aria-label="Close"
        className="absolute right-2 top-2 rounded-md p-1 text-foreground/50 opacity-0 transition-opacity hover:text-foreground focus:opacity-100 focus:outline-none focus:ring-1 group-hover:opacity-100"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M3 3L13 13M13 3L3 13" stroke="currentColor" strokeLinecap="round" />
        </svg>
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider")
  }
  return ctx
}

export interface ToastActionProps {
  altText: string
  children: ReactNode
  onClick?: () => void
  className?: string
}

export function ToastAction({ altText, children, onClick, className }: ToastActionProps) {
  return (
    <ToastPrimitive.Action
      altText={altText}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 shrink-0 items-center justify-center rounded-md border bg-transparent px-3 text-sm font-medium",
        "ring-offset-background transition-colors hover:bg-secondary focus:outline-none focus:ring-1",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      asChild
    >
      {children as ReactNode}
    </ToastPrimitive.Action>
  )
}