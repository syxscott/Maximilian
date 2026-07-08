import { useCallback, useEffect, useRef, useState } from "react"

export interface AutoScrollOptions {
  working: () => boolean
  onUserInteracted?: () => void
  overflowAnchor?: "none" | "auto" | "dynamic"
  bottomThreshold?: number
}

export function createAutoScroll(options: AutoScrollOptions) {
  // Use a ref-stored controller-like object to emulate Solid's createStore semantics.
  // All state lives inside the returned object so callers can call this at module/component scope.
  const [userScrolled, setUserScrolled] = useState(false)
  const scrollRef = useRef<HTMLElement | null>(null)
  const contentRef = useRef<HTMLElement | null>(null)

  const settlingRef = useRef(false)
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const autoRef = useRef<{ top: number; time: number } | undefined>(undefined)

  const threshold = () => options.bottomThreshold ?? 10

  const active = () => options.working() || settlingRef.current

  const distanceFromBottom = (el: HTMLElement) => {
    return el.scrollHeight - el.clientHeight - el.scrollTop
  }

  const canScroll = (el: HTMLElement) => {
    return el.scrollHeight - el.clientHeight > 1
  }

  // Browsers can dispatch scroll events asynchronously. If new content arrives
  // between us calling `scrollTo()` and the subsequent `scroll` event firing,
  // the handler can see a non-zero `distanceFromBottom` and incorrectly assume
  // the user scrolled.
  const markAuto = (el: HTMLElement) => {
    autoRef.current = {
      top: Math.max(0, el.scrollHeight - el.clientHeight),
      time: Date.now(),
    }

    if (autoTimerRef.current) clearTimeout(autoTimerRef.current)
    autoTimerRef.current = setTimeout(() => {
      autoRef.current = undefined
      autoTimerRef.current = undefined
    }, 1500)
  }

  const isAuto = (el: HTMLElement) => {
    const a = autoRef.current
    if (!a) return false

    if (Date.now() - a.time > 1500) {
      autoRef.current = undefined
      return false
    }

    return Math.abs(el.scrollTop - a.top) < 2
  }

  const scrollToBottomNow = (behavior: ScrollBehavior) => {
    const el = scrollRef.current
    if (!el) return
    markAuto(el)
    if (behavior === "smooth") {
      el.scrollTo({ top: el.scrollHeight, behavior })
      return
    }

    // `scrollTop` assignment bypasses any CSS `scroll-behavior: smooth`.
    el.scrollTop = el.scrollHeight
  }

  const scrollToBottom = (force: boolean) => {
    if (!force && !active()) return

    if (force && userScrolled) setUserScrolled(false)

    const el = scrollRef.current
    if (!el) return

    if (!force && userScrolled) return

    const distance = distanceFromBottom(el)
    if (distance < 2) {
      markAuto(el)
      return
    }

    // For auto-following content we prefer immediate updates to avoid
    // visible "catch up" animations while content is still settling.
    scrollToBottomNow("auto")
  }

  const stop = () => {
    const el = scrollRef.current
    if (!el) return
    if (!canScroll(el)) {
      if (userScrolled) setUserScrolled(false)
      return
    }
    if (userScrolled) return

    setUserScrolled(true)
    options.onUserInteracted?.()
  }

  const handleWheel = (e: WheelEvent) => {
    if (e.deltaY >= 0) return
    // If the user is scrolling within a nested scrollable region (tool output,
    // code block, etc), don't treat it as leaving the "follow bottom" mode.
    // Those regions opt in via `data-scrollable`.
    const el = scrollRef.current
    const target = e.target instanceof Element ? e.target : undefined
    const nested = target?.closest("[data-scrollable]")
    if (el && nested && nested !== el) return
    stop()
  }

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return

    if (!canScroll(el)) {
      if (userScrolled) setUserScrolled(false)
      return
    }

    if (distanceFromBottom(el) < threshold()) {
      if (userScrolled) setUserScrolled(false)
      return
    }

    // Ignore scroll events triggered by our own scrollToBottom calls.
    if (!userScrolled && isAuto(el)) {
      scrollToBottom(false)
      return
    }

    stop()
  }

  const handleInteraction = () => {
    if (!active()) return
    const selection = window.getSelection()
    if (selection && selection.toString().length > 0) {
      stop()
    }
  }

  const updateOverflowAnchor = (el: HTMLElement) => {
    const mode = options.overflowAnchor ?? "dynamic"

    if (mode === "none") {
      el.style.overflowAnchor = "none"
      return
    }

    if (mode === "auto") {
      el.style.overflowAnchor = "auto"
      return
    }

    el.style.overflowAnchor = userScrolled ? "auto" : "none"
  }

  // ResizeObserver on content
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      const scrollEl = scrollRef.current
      if (scrollEl && !canScroll(scrollEl)) {
        if (userScrolled) setUserScrolled(false)
        return
      }
      if (!active()) return
      if (userScrolled) return
      // ResizeObserver fires after layout, before paint.
      // Keep the bottom locked in the same frame to avoid visible
      // "jump up then catch up" artifacts while streaming content.
      scrollToBottom(false)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [userScrolled])

  // React to changes in `working`
  useEffect(() => {
    // We don't know the value of `options.working()` until it's called.
    // Since `working` is a function, we re-check on render; this effect runs
    // once but the actual reaction logic is invoked via `active()` everywhere.
    // To keep the original behavior, we poll on mount and when dependencies change.
    settlingRef.current = false
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
    settleTimerRef.current = undefined

    if (options.working()) {
      if (!userScrolled) scrollToBottom(true)
      return
    }

    settlingRef.current = true
    settleTimerRef.current = setTimeout(() => {
      settlingRef.current = false
    }, 300)
    // We intentionally do NOT depend on `options.working` identity to match the
    // imperative intent of the original; consumers can call `resume` / `scrollToBottom` directly.
  }, [])

  // Update overflow anchor when scrollRef or userScrolled changes
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    updateOverflowAnchor(el)
  }, [userScrolled])

  // Attach native listeners on scrollRef
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const wheelListener = (e: Event) => handleWheel(e as WheelEvent)
    el.addEventListener("wheel", wheelListener, { passive: true })
    return () => {
      el.removeEventListener("wheel", wheelListener)
    }
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
      if (autoTimerRef.current) clearTimeout(autoTimerRef.current)
    }
  }, [])

  // Escape key closes dialogs - kept here to mirror the lifecycle integration
  // (the original wires this up in `createEffect`); we expose `handleInteraction`
  // and `pause` / `resume` for callers to attach to DOM as needed.

  const setScrollRef = useCallback((el: HTMLElement | null) => {
    scrollRef.current = el ?? undefined as any
  }, [])
  const setContentRef = useCallback((el: HTMLElement | null) => {
    contentRef.current = el ?? undefined as any
  }, [])

  return {
    scrollRef: setScrollRef,
    contentRef: setContentRef,
    handleScroll,
    handleInteraction,
    pause: stop,
    resume: () => {
      if (userScrolled) setUserScrolled(false)
      scrollToBottom(true)
    },
    scrollToBottom: () => scrollToBottom(false),
    forceScrollToBottom: () => scrollToBottom(true),
    userScrolled,
  }
}