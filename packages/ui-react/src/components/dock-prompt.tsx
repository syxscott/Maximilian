import { forwardRef, type KeyboardEvent, type ReactNode } from "react"
import { DockShell, DockTray } from "./dock-surface.js"

export interface DockPromptProps {
  kind: "question" | "permission"
  header: ReactNode
  children: ReactNode
  footer: ReactNode
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void
}

export const DockPrompt = forwardRef<HTMLDivElement, DockPromptProps>(
  ({ kind, header, children, footer, onKeyDown }, ref) => {
    const slot = (name: string) => `${kind}-${name}`

    return (
      <div data-component="dock-prompt" data-kind={kind} ref={ref} onKeyDown={onKeyDown}>
        <DockShell data-slot={slot("body")}>
          <div data-slot={slot("header")}>{header}</div>
          <div data-slot={slot("content")}>{children}</div>
        </DockShell>
        <DockTray data-slot={slot("footer")}>{footer}</DockTray>
      </div>
    )
  },
)
DockPrompt.displayName = "DockPrompt"
