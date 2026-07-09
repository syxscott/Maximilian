import * as React from "react"
import { cn } from "../../lib/utils.js"

type OnChange = (value: string | null) => void

type SegmentedControlContextValue = {
  selected: string | null
  groupDisabled: boolean
  select: (value: string) => void
  clearIfAllowed: (value: string) => void
  focusNext: (from: HTMLButtonElement, direction: 1 | -1) => void
  allowDeselect: boolean
}

const SegmentedControlContext = React.createContext<SegmentedControlContextValue | null>(null)

function useSegmentedControlContext() {
  const ctx = React.useContext(SegmentedControlContext)
  if (!ctx)
    throw new Error("SegmentedControlItemV2 must be used inside SegmentedControlV2")
  return ctx
}

export interface SegmentedControlV2Props
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange" | "defaultValue"> {
  value?: string | null
  defaultValue?: string
  onChange?: OnChange
  allowDeselect?: boolean
  disabled?: boolean
}

export const SegmentedControlV2 = React.forwardRef<HTMLDivElement, SegmentedControlV2Props>(
  (
    {
      className,
      children,
      value,
      defaultValue,
      onChange,
      allowDeselect = false,
      disabled = false,
      ...rest
    },
    ref,
  ) => {
    const isControlled = value !== undefined
    const [internal, setInternal] = React.useState<string | null>(defaultValue ?? null)
    const selected = isControlled ? value ?? null : internal

    const setSelected = React.useCallback(
      (next: string | null) => {
        if (!isControlled) setInternal(next)
        onChange?.(next)
      },
      [isControlled, onChange],
    )

    const select = React.useCallback(
      (v: string) => setSelected(v),
      [setSelected],
    )

    const clearIfAllowed = React.useCallback(
      (v: string) => {
        if (!allowDeselect || selected !== v) return
        setSelected(null)
      },
      [allowDeselect, selected, setSelected],
    )

    const focusNext = React.useCallback(
      (from: HTMLButtonElement, direction: 1 | -1) => {
        const root = from.closest(`[data-slot="segmented-control-v2"]`)
        if (!root) return
        const buttons = Array.from(
          root.querySelectorAll<HTMLButtonElement>(
            `button[data-slot="segmented-control-v2-item"]`,
          ),
        ).filter((b) => !b.disabled)
        const i = buttons.indexOf(from)
        const next = buttons[i + direction]
        next?.focus()
      },
      [],
    )

    const ctx = React.useMemo<SegmentedControlContextValue>(
      () => ({
        selected,
        groupDisabled: disabled,
        select,
        clearIfAllowed,
        focusNext,
        allowDeselect,
      }),
      [selected, disabled, select, clearIfAllowed, focusNext, allowDeselect],
    )

    return (
      <SegmentedControlContext.Provider value={ctx}>
        <div
          ref={ref}
          role="group"
          data-component="segmented-control-v2"
          data-slot="segmented-control-v2"
          className={cn(className)}
          {...rest}
        >
          {children}
        </div>
      </SegmentedControlContext.Provider>
    )
  },
)
SegmentedControlV2.displayName = "SegmentedControlV2"

export interface SegmentedControlItemV2Props
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type" | "value"> {
  value: string
}

export const SegmentedControlItemV2 = React.forwardRef<
  HTMLButtonElement,
  SegmentedControlItemV2Props
>(({ className, children, value, disabled = false, onClick, onKeyDown, ...rest }, ref) => {
  const ctx = useSegmentedControlContext()
  const pressed = ctx.selected === value
  const isDisabled = ctx.groupDisabled || disabled

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(e)
    if (e.defaultPrevented || isDisabled) return
    if (pressed) ctx.clearIfAllowed(value)
    else ctx.select(value)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    onKeyDown?.(e)
    if (e.defaultPrevented || isDisabled) return
    const t = e.currentTarget
    if (e.key === "ArrowRight") {
      e.preventDefault()
      ctx.focusNext(t, 1)
    } else if (e.key === "ArrowLeft") {
      e.preventDefault()
      ctx.focusNext(t, -1)
    } else if (e.key === "Home") {
      e.preventDefault()
      const root = t.closest(`[data-slot="segmented-control-v2"]`)
      const first = root?.querySelector<HTMLButtonElement>(
        `button[data-slot="segmented-control-v2-item"]:not(:disabled)`,
      )
      first?.focus()
    } else if (e.key === "End") {
      e.preventDefault()
      const root = t.closest(`[data-slot="segmented-control-v2"]`)
      const buttons = root?.querySelectorAll<HTMLButtonElement>(
        `button[data-slot="segmented-control-v2-item"]:not(:disabled)`,
      )
      const last = buttons?.[buttons.length - 1]
      last?.focus()
    }
  }

  return (
    <button
      ref={ref}
      type="button"
      data-slot="segmented-control-v2-item"
      data-pressed={pressed ? "" : undefined}
      aria-pressed={pressed}
      disabled={isDisabled}
      className={cn(className)}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      {...rest}
    >
      <span data-slot="segmented-control-v2-item-label">{children}</span>
    </button>
  )
})
SegmentedControlItemV2.displayName = "SegmentedControlItemV2"
