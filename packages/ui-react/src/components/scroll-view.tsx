import * as React from "react"
import { cn } from "../lib/utils.js"

export interface ScrollViewProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onScroll"> {
  viewportRef?: (el: HTMLDivElement | null) => void
  orientation?: "vertical" | "horizontal"
  i18n?: {
    ariaLabel?: string
  }
}

export const scrollKey = (
  event: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey">,
) => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return

  switch (event.key) {
    case "PageDown":
      return "page-down" as const
    case "PageUp":
      return "page-up" as const
    case "Home":
      return "home" as const
    case "End":
      return "end" as const
    case "ArrowUp":
      return "up" as const
    case "ArrowDown":
      return "down" as const
  }
  return undefined
}

export function scrollTopFromThumbPointer(input: {
  pointer: number
  viewportTop: number
  grabOffset: number
  clientHeight: number
  scrollHeight: number
  thumbHeight: number
}) {
  const padding = 8
  const maxThumbTop = input.clientHeight - padding * 2 - input.thumbHeight
  if (maxThumbTop <= 0) return 0
  const thumbTop = Math.max(
    0,
    Math.min(input.pointer - input.viewportTop - padding - input.grabOffset, maxThumbTop),
  )
  return (thumbTop / maxThumbTop) * Math.max(0, input.scrollHeight - input.clientHeight)
}

interface ScrollViewEventProps {
  onScroll?: React.UIEventHandler<HTMLDivElement>
  onWheel?: React.WheelEventHandler<HTMLDivElement>
  onTouchStart?: React.TouchEventHandler<HTMLDivElement>
  onTouchMove?: React.TouchEventHandler<HTMLDivElement>
  onTouchEnd?: React.TouchEventHandler<HTMLDivElement>
  onTouchCancel?: React.TouchEventHandler<HTMLDivElement>
  onPointerDown?: React.PointerEventHandler<HTMLDivElement>
  onClick?: React.MouseEventHandler<HTMLDivElement>
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>
}

export const ScrollView = React.forwardRef<HTMLDivElement, ScrollViewProps & ScrollViewEventProps>(
  function ScrollView(props, ref) {
    const {
      className,
      children,
      viewportRef,
      orientation = "vertical",
      style,
      onScroll,
      onWheel,
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTouchCancel,
      onPointerDown,
      onClick,
      onKeyDown,
      i18n,
      ...rest
    } = props

    const internalViewportRef = React.useRef<HTMLDivElement | null>(null)
    const thumbRef = React.useRef<HTMLDivElement | null>(null)

    const setViewportRef = React.useCallback(
      (el: HTMLDivElement | null) => {
        internalViewportRef.current = el
        viewportRef?.(el)
      },
      [viewportRef],
    )

    const [isHovered, setIsHovered] = React.useState(false)
    const [isDragging, setIsDragging] = React.useState(false)
    const [thumbHeight, setThumbHeight] = React.useState(0)
    const [thumbTop, setThumbTop] = React.useState(0)
    const [showThumb, setShowThumb] = React.useState(false)

    const updateThumb = React.useCallback(() => {
      const viewport = internalViewportRef.current
      if (!viewport) return
      const { scrollTop, scrollHeight, clientHeight } = viewport

      if (scrollHeight <= clientHeight || scrollHeight === 0) {
        setShowThumb(false)
        return
      }

      setShowThumb(true)
      const trackPadding = 8
      const trackHeight = clientHeight - trackPadding * 2

      const minThumbHeight = 32
      let height = (clientHeight / scrollHeight) * trackHeight
      height = Math.max(height, minThumbHeight)

      const maxScrollTop = scrollHeight - clientHeight
      const maxThumbTop = trackHeight - height

      const top = maxScrollTop > 0 ? (scrollTop / maxScrollTop) * maxThumbTop : 0

      const boundedTop = trackPadding + Math.max(0, Math.min(top, maxThumbTop))

      setThumbHeight(height)
      setThumbTop(boundedTop)
    }, [])

    React.useEffect(() => {
      updateThumb()
    }, [updateThumb])

    React.useEffect(() => {
      const viewport = internalViewportRef.current
      if (!viewport) return

      const firstChild = viewport.firstElementChild
      if (!firstChild || !(firstChild instanceof HTMLElement)) return

      const observer = new ResizeObserver(() => updateThumb())
      observer.observe(viewport)
      observer.observe(firstChild)

      return () => observer.disconnect()
    }, [updateThumb])

    const onThumbPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(true)
      const thumb = thumbRef.current
      const viewport = internalViewportRef.current
      if (!thumb || !viewport) return

      const grabOffset = e.clientY - thumb.getBoundingClientRect().top
      thumb.setPointerCapture(e.pointerId)

      const onPointerMove = (ev: PointerEvent) => {
        const { scrollHeight, clientHeight } = viewport
        viewport.scrollTop = scrollTopFromThumbPointer({
          pointer: ev.clientY,
          viewportTop: viewport.getBoundingClientRect().top,
          grabOffset,
          clientHeight,
          scrollHeight,
          thumbHeight,
        })
      }

      const done = (ev: PointerEvent) => {
        setIsDragging(false)
        if (thumb.hasPointerCapture(ev.pointerId)) {
          thumb.releasePointerCapture(ev.pointerId)
        }
        thumb.removeEventListener("pointermove", onPointerMove)
        thumb.removeEventListener("pointerup", done)
        thumb.removeEventListener("pointercancel", done)
      }

      thumb.addEventListener("pointermove", onPointerMove)
      thumb.addEventListener("pointerup", done)
      thumb.addEventListener("pointercancel", done)
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      const active = document.activeElement
      if (
        active &&
        active instanceof HTMLElement &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName)
      ) {
        onKeyDown?.(e)
        return
      }

      const next = scrollKey(e)
      if (!next) {
        onKeyDown?.(e)
        return
      }

      const viewport = internalViewportRef.current
      if (!viewport) return

      const scrollAmount = viewport.clientHeight * 0.8
      const lineAmount = 40

      switch (next) {
        case "page-down":
          e.preventDefault()
          viewport.scrollBy({ top: scrollAmount, behavior: "smooth" })
          break
        case "page-up":
          e.preventDefault()
          viewport.scrollBy({ top: -scrollAmount, behavior: "smooth" })
          break
        case "home":
          e.preventDefault()
          viewport.scrollTo({ top: 0, behavior: "smooth" })
          break
        case "end":
          e.preventDefault()
          viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" })
          break
        case "up":
          e.preventDefault()
          viewport.scrollBy({ top: -lineAmount, behavior: "smooth" })
          break
        case "down":
          e.preventDefault()
          viewport.scrollBy({ top: lineAmount, behavior: "smooth" })
          break
      }
      onKeyDown?.(e)
    }

    return (
      <div
        ref={ref}
        className={cn("scroll-view relative", className)}
        style={style}
        onPointerEnter={() => setIsHovered(true)}
        onPointerLeave={() => setIsHovered(false)}
        {...rest}
      >
        <div
          ref={setViewportRef}
          className="scroll-view__viewport h-full w-full overflow-auto"
          onScroll={(e) => {
            updateThumb()
            onScroll?.(e)
          }}
          onWheel={onWheel}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchCancel}
          onPointerDown={onPointerDown}
          onClick={onClick}
          tabIndex={0}
          role="region"
          aria-label={i18n?.ariaLabel ?? "Scrollable content"}
          onKeyDown={handleKeyDown}
        >
          {children}
        </div>

        {showThumb && (
          <div
            ref={thumbRef}
            onPointerDown={onThumbPointerDown}
            className="scroll-view__thumb absolute right-1 w-1.5 cursor-pointer rounded-full bg-foreground/30 transition-colors hover:bg-foreground/50"
            data-visible={isHovered || isDragging}
            data-dragging={isDragging}
            style={{
              height: `${thumbHeight}px`,
              transform: `translateY(${thumbTop}px)`,
              zIndex: 100,
            }}
          />
        )}
      </div>
    )
  },
)