import React from "react"
export interface DialogProps { open?: boolean; onOpenChange?: (open: boolean) => void; children?: React.ReactNode; title?: string }
export function Dialog({ children }: DialogProps) { return <>{children}</> }
export function DialogContent({ children }: { children?: React.ReactNode }) { return <>{children}</> }
export function DialogHeader({ children }: { children?: React.ReactNode }) { return <>{children}</> }
export function DialogTitle({ children }: { children?: React.ReactNode }) { return <>{children}</> }
export function DialogFooter({ children }: { children?: React.ReactNode }) { return <>{children}</> }
export function DialogClose() { return null }
export function DialogTrigger({ children }: { children?: React.ReactNode }) { return <>{children}</> }
