// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * HoverCard — portal panel shown after a 300ms hover on the trigger
 * (chat-demo search/HoverCard.tsx borrowing). Flips above the trigger
 * when there is no room below; the pointer can move into the card
 * without closing it (leave delay + mouseenter cancel on the card).
 */
import {
  useEffect,
  type CSSProperties,
  type HTMLAttributes,
  type MutableRefObject,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import { useAnchoredPosition, useDelayedOpen } from "./anchored"

const ENTER_DELAY = 300
const LEAVE_DELAY = 100
const GAP = 6

export type HoverCardTrigger = (props: {
  domRef: MutableRefObject<HTMLSpanElement | null>
  domProps: Omit<HTMLAttributes<HTMLSpanElement>, "children" | "className" | "style"> | undefined
}) => ReactNode

export const HoverCard = ({
  renderTrigger,
  children,
  testId = "hover-card",
}: {
  renderTrigger: HoverCardTrigger
  children: ReactNode
  /** data-testid of the portal panel (test targeting). */
  testId?: string
}) => {
  const { open, schedule, cancel } = useDelayedOpen()
  const { anchorRef, floatingRef, position } = useAnchoredPosition<HTMLSpanElement, HTMLDivElement>(
    open,
    { align: "center", offset: GAP },
  )

  useEffect(() => () => cancel(), [cancel])

  return (
    <>
      {renderTrigger({
        domRef: anchorRef,
        domProps: {
          onMouseEnter: () => schedule(true, ENTER_DELAY),
          onMouseLeave: () => schedule(false, LEAVE_DELAY),
        },
      })}
      {open
        ? createPortal(
            <div
              ref={floatingRef}
              className="z-40 max-w-sm rounded-md border border-border bg-popover text-popover-foreground shadow-md"
              style={(position as CSSProperties) ?? { top: 0, left: 0, visibility: "hidden" }}
              onMouseEnter={cancel}
              onMouseLeave={() => schedule(false, LEAVE_DELAY)}
              data-testid={testId}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
