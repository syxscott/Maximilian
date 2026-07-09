import type { HTMLAttributes } from "react"
import { cn } from "../lib/utils.js"

export interface KeybindV2Props extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  keys: string[]
  variant?: "neutral" | "ghost"
}

export function KeybindV2({ keys, variant = "neutral", className, ...rest }: KeybindV2Props) {
  return (
    <div
      data-component="keybind-v2"
      data-variant={variant}
      className={cn("inline-flex items-center gap-1", className)}
      {...rest}
    >
      {keys.map((key, i) => (
        <div
          key={`${key}-${i}`}
          data-slot="keybind-v2-key"
          className="inline-flex items-center justify-center rounded border bg-muted px-1.5 py-0.5 text-xs font-medium"
        >
          <span data-slot="keybind-v2-label">{key}</span>
        </div>
      ))}
    </div>
  )
}