"use client"

import * as React from "react"
import { cn } from "../lib/utils"

function commonPrefix(active: string, done: string) {
  const a = Array.from(active)
  const b = Array.from(done)
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return {
    prefix: a.slice(0, i).join(""),
    active: a.slice(i).join(""),
    done: b.slice(i).join(""),
  }
}

function contentWidth(el: HTMLSpanElement | undefined | null) {
  if (!el) return
  return `${Math.ceil(el.getBoundingClientRect().width)}px`
}

export interface ToolStatusTitleProps extends React.HTMLAttributes<HTMLSpanElement> {
  active: boolean
  activeText: string
  doneText: string
  split?: boolean
}

export const ToolStatusTitle: React.FC<ToolStatusTitleProps> = ({
  active,
  activeText,
  doneText,
  className,
  split = true,
  ...rest
}) => {
  const splitParts = React.useMemo(() => commonPrefix(activeText, doneText), [activeText, doneText])
  const suffix =
    split &&
    splitParts.prefix.length >= 2 &&
    splitParts.active.length > 0 &&
    splitParts.done.length > 0
  const prefixLen = Array.from(splitParts.prefix).length
  const activeTail = suffix ? splitParts.active : activeText
  const doneTail = suffix ? splitParts.done : doneText

  const [state, setState] = React.useState({
    active,
    animating: false,
    width: undefined as string | undefined,
  })
  const activeRef = React.useRef<HTMLSpanElement | null>(null)
  const doneRef = React.useRef<HTMLSpanElement | null>(null)
  const widthRef = React.useRef<HTMLSpanElement | null>(null)
  const frameRef = React.useRef<number | undefined>(undefined)
  const finishTimerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const finish = React.useCallback(() => {
    if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current)
    if (finishTimerRef.current !== undefined) clearTimeout(finishTimerRef.current)
    frameRef.current = undefined
    finishTimerRef.current = undefined
    setState((s) => ({ ...s, animating: false, width: undefined }))
  }, [])

  const animate = React.useCallback(() => {
    const first = contentWidth(widthRef.current)
    finish()
    setState((s) => ({ ...s, animating: true, active }))
    const last = contentWidth(active ? activeRef.current : doneRef.current)
    if (!first || !last) {
      finish()
      return
    }
    setState((s) => ({ ...s, width: first }))
    if (first === last) {
      finishTimerRef.current = setTimeout(finish, 600)
      return
    }
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = undefined
      setState((s) => ({ ...s, width: last }))
      finishTimerRef.current = setTimeout(finish, 600)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, activeTail, doneTail])

  React.useEffect(() => {
    animate()
    return finish
  }, [animate, finish])

  React.useEffect(() => {
    return () => {
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current)
      if (finishTimerRef.current !== undefined) clearTimeout(finishTimerRef.current)
    }
  }, [])

  return (
    <span
      data-component="tool-status-title"
      data-active={state.active ? "true" : "false"}
      data-ready={state.animating ? "true" : "false"}
      data-mode={suffix ? "suffix" : "swap"}
      className={cn(className)}
      aria-label={state.active ? activeText : doneText}
      {...rest}
    >
      {!suffix ? (
        <span data-slot="tool-status-swap" ref={widthRef} style={{ width: state.width }}>
          {(state.animating || state.active) && (
            <span data-slot="tool-status-active" ref={activeRef}>
              <span data-slot="text-shimmer-char">
                <span data-slot="text-shimmer-char-base" aria-hidden="true">
                  {activeTail}
                </span>
              </span>
            </span>
          )}
          {(state.animating || !state.active) && (
            <span data-slot="tool-status-done" ref={doneRef}>
              <span data-slot="text-shimmer-char">
                <span data-slot="text-shimmer-char-base" aria-hidden="true">
                  {doneTail}
                </span>
              </span>
            </span>
          )}
        </span>
      ) : (
        <span data-slot="tool-status-suffix">
          <span data-slot="tool-status-prefix">
            <span data-slot="text-shimmer-char">
              <span data-slot="text-shimmer-char-base" aria-hidden="true">
                {splitParts.prefix}
              </span>
            </span>
          </span>
          <span data-slot="tool-status-tail" ref={widthRef} style={{ width: state.width }}>
            {(state.animating || state.active) && (
              <span data-slot="tool-status-active" ref={activeRef}>
                <span data-slot="text-shimmer-char">
                  <span data-slot="text-shimmer-char-base" aria-hidden="true">
                    {activeTail}
                  </span>
                </span>
              </span>
            )}
            {(state.animating || !state.active) && (
              <span data-slot="tool-status-done" ref={doneRef}>
                <span data-slot="text-shimmer-char">
                  <span data-slot="text-shimmer-char-base" aria-hidden="true">
                    {doneTail}
                  </span>
                </span>
              </span>
            )}
          </span>
        </span>
      )}
    </span>
  )
}