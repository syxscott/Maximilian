"use client"

import * as React from "react"
import { cn } from "../lib/utils"
import { AnimatedCountLabel } from "./tool-count-label"

export interface CountItem {
  key: string
  count: number
  one: string
  other: string
}

export interface AnimatedCountListProps extends React.HTMLAttributes<HTMLSpanElement> {
  items: CountItem[]
  fallback?: string
}

export const AnimatedCountList: React.FC<AnimatedCountListProps> = ({
  items,
  fallback = "",
  className,
  ...rest
}) => {
  const visible = items.filter((item) => item.count > 0)
  const showEmpty = visible.length === 0 && fallback.length > 0

  return (
    <span data-component="tool-count-summary" className={cn(className)} {...rest}>
      <span data-slot="tool-count-summary-empty" data-active={showEmpty ? "true" : "false"}>
        <span data-slot="tool-count-summary-empty-inner">{fallback}</span>
      </span>

      {items.map((item, index) => {
        const active = item.count > 0
        let hasPrev = false
        for (let i = index - 1; i >= 0; i--) {
          if (items[i].count > 0) {
            hasPrev = true
            break
          }
        }
        return (
          <React.Fragment key={item.key}>
            <span data-slot="tool-count-summary-prefix" data-active={active && hasPrev ? "true" : "false"}>
              ,
            </span>
            <span data-slot="tool-count-summary-item" data-active={active ? "true" : "false"}>
              <span data-slot="tool-count-summary-item-inner">
                <AnimatedCountLabel
                  one={item.one}
                  other={item.other}
                  count={Math.max(0, Math.round(item.count))}
                />
              </span>
            </span>
          </React.Fragment>
        )
      })}
    </span>
  )
}