import { forwardRef, type HTMLAttributes, type FormHTMLAttributes } from "react"
import { cn } from "../lib/utils"

export interface DockTrayProps extends HTMLAttributes<HTMLDivElement> {
  attach?: "none" | "top"
}

export const DockShell = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...rest }, ref) => {
    return (
      <div ref={ref} data-dock-surface="shell" className={cn(className)} {...rest}>
        {children}
      </div>
    )
  },
)
DockShell.displayName = "DockShell"

export const DockShellForm = forwardRef<HTMLFormElement, FormHTMLAttributes<HTMLFormElement>>(
  ({ className, children, ...rest }, ref) => {
    return (
      <form ref={ref} data-dock-surface="shell" className={cn(className)} {...rest}>
        {children}
      </form>
    )
  },
)
DockShellForm.displayName = "DockShellForm"

export const DockTray = forwardRef<HTMLDivElement, DockTrayProps>(
  ({ attach, className, children, ...rest }, ref) => {
    return (
      <div
        ref={ref}
        data-dock-surface="tray"
        data-dock-attach={attach || "none"}
        className={cn(className)}
        {...rest}
      >
        {children}
      </div>
    )
  },
)
DockTray.displayName = "DockTray"
