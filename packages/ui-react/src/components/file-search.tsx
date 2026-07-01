import { useCallback, useRef, useEffect, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { createPortal } from "react-dom"
import { useI18n } from "../context/i18n"
import { Icon } from "./icon"

export interface FileSearchBarProps {
  pos: { top: number; right: number }
  query: string
  index: number
  count: number
  setInput?: (el: HTMLInputElement) => void
  onInput: (value: string) => void
  onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void
  onClose: () => void
  onPrev: () => void
  onNext: () => void
}

export function FileSearchBar({
  pos,
  query,
  index,
  count,
  setInput,
  onInput,
  onKeyDown,
  onClose,
  onPrev,
  onNext,
}: FileSearchBarProps) {
  const i18n = useI18n()
  const inputRef = useRef<HTMLInputElement>(null)

  const handleRef = useCallback(
    (el: HTMLInputElement | null) => {
      if (el) {
        inputRef.current = el
        setInput?.(el)
      }
    },
    [setInput],
  )

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return createPortal(
    <div
      className="fixed z-50 flex h-8 items-center gap-2 rounded-md border border-border-base bg-background-base px-3 shadow-md"
      style={{
        top: `${pos.top}px`,
        right: `${pos.right}px`,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <Icon name="magnifying-glass" size="small" className="text-text-weak shrink-0" />
      <input
        ref={handleRef}
        placeholder={i18n.t("ui.fileSearch.placeholder")}
        value={query}
        className="w-40 bg-transparent outline-none text-14-regular text-text-strong placeholder:text-text-weak"
        onInput={(e) => onInput(e.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
      <div className="shrink-0 text-12-regular text-text-weak tabular-nums text-right" style={{ width: "10ch" }}>
        {count ? `${index + 1}/${count}` : "0/0"}
      </div>
      <div className="flex items-center">
        <button
          type="button"
          className="size-6 grid place-items-center rounded text-text-weak hover:bg-surface-base-hover hover:text-text-strong disabled:opacity-40 disabled:pointer-events-none"
          disabled={count === 0}
          aria-label={i18n.t("ui.fileSearch.previousMatch")}
          onClick={onPrev}
        >
          <Icon name="chevron-down" size="small" className="rotate-180" />
        </button>
        <button
          type="button"
          className="size-6 grid place-items-center rounded text-text-weak hover:bg-surface-base-hover hover:text-text-strong disabled:opacity-40 disabled:pointer-events-none"
          disabled={count === 0}
          aria-label={i18n.t("ui.fileSearch.nextMatch")}
          onClick={onNext}
        >
          <Icon name="chevron-down" size="small" />
        </button>
      </div>
      <button
        type="button"
        className="size-6 grid place-items-center rounded text-text-weak hover:bg-surface-base-hover hover:text-text-strong"
        aria-label={i18n.t("ui.fileSearch.close")}
        onClick={onClose}
      >
        <Icon name="close-small" size="small" />
      </button>
    </div>,
    document.body,
  )
}
