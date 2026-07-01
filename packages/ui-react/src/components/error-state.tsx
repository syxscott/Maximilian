import * as React from "react"
import { AlertTriangle } from "lucide-react"
import { cn } from "../lib/utils"

export interface ErrorStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title?: React.ReactNode
  description?: React.ReactNode
  /** Error object or string. Used for default message. */
  error?: unknown
  action?: React.ReactNode
  variant?: "default" | "compact" | "card" | "inline"
}

function getMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message)
  }
  return "Something went wrong."
}

export const ErrorState = React.forwardRef<HTMLDivElement, ErrorStateProps>(function ErrorState(
  { title = "Something went wrong", description, error, action, variant = "default", className, ...rest },
  ref,
) {
  const message = error !== undefined ? getMessage(error) : undefined
  const body = description ?? message

  if (variant === "inline") {
    return (
      <div
        ref={ref}
        data-component="error-state"
        data-variant="inline"
        role="alert"
        className={cn(
          "flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive",
          className,
        )}
        {...rest}
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="flex-1">
          <p className="font-medium">{title}</p>
          {body ? <p className="mt-0.5 text-xs text-destructive/80">{body}</p> : null}
        </div>
        {action ? <div className="ml-2 shrink-0">{action}</div> : null}
      </div>
    )
  }

  return (
    <div
      ref={ref}
      data-component="error-state"
      data-variant={variant}
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center text-center",
        variant === "default" && "gap-3 py-12",
        variant === "compact" && "gap-2 py-6",
        variant === "card" &&
          "gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-8",
        className,
      )}
      {...rest}
    >
      <div
        aria-hidden="true"
        className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive"
      >
        <AlertTriangle className="h-6 w-6" />
      </div>
      <div className="flex flex-col items-center gap-1">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {body ? (
          <p className="max-w-md text-sm text-muted-foreground">{body}</p>
        ) : null}
      </div>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
})
