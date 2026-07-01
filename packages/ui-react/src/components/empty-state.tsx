import * as React from "react"
import { cn } from "../lib/utils"

export interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  icon?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  variant?: "default" | "compact" | "card"
}

export const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(function EmptyState(
  { icon, title, description, action, variant = "default", className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      data-component="empty-state"
      data-variant={variant}
      role="status"
      className={cn(
        "flex flex-col items-center justify-center text-center",
        variant === "default" && "gap-3 py-12",
        variant === "compact" && "gap-2 py-6",
        variant === "card" &&
          "gap-3 rounded-md border border-dashed border-border bg-muted/30 p-8",
        className,
      )}
      {...rest}
    >
      {icon ? (
        <div
          aria-hidden="true"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
        >
          {icon}
        </div>
      ) : null}
      <div className="flex flex-col items-center gap-1">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {description ? (
          <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
})
