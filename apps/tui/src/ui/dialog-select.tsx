import React from "react"
export interface DialogSelectProps { open?: boolean; onOpenChange?: (open: boolean) => void; children?: React.ReactNode; items?: unknown[]; onSelect?: (item: unknown) => void }
export function DialogSelect({ children }: DialogSelectProps) { return <>{children}</> }
