import * as React from "react"
import { Pipette, Check } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"
import { cn } from "../lib/utils"

const PRESET_COLORS = [
  "#000000", "#ffffff", "#f87171", "#fb923c", "#fbbf24", "#a3e635",
  "#34d399", "#22d3ee", "#60a5fa", "#818cf8", "#c084fc", "#f472b6",
  "#94a3b8", "#64748b", "#475569", "#1e293b", "#fef2f2", "#fee2e2",
  "#fecaca", "#fca5a5", "#fff7ed", "#ffedd5", "#fed7aa", "#fdba74",
  "#fef3c7", "#fde68a", "#fcd34d", "#facc15", "#ecfccb", "#d9f99d",
  "#bef264", "#a3e635", "#84cc16", "#dcfce7", "#bbf7d0", "#86efac",
  "#4ade80", "#22c55e", "#16a34a", "#d1fae5", "#a7f3d0", "#6ee7b7",
  "#34d399", "#10b981", "#059669", "#ccfbf1", "#99f6e4", "#5eead4",
  "#2dd4bf", "#14b8a6", "#0d9488", "#cffafe", "#a5f3fc", "#67e8f9",
  "#22d3ee", "#06b6d4", "#0891b2", "#e0f2fe", "#bae6fd", "#7dd3fc",
  "#38bdf8", "#0ea5e9", "#0284c7", "#dbeafe", "#bfdbfe", "#93c5fd",
  "#60a5fa", "#3b82f6", "#2563eb", "#e0e7ff", "#c7d2fe", "#a5b4fc",
  "#818cf8", "#6366f1", "#4f46e5", "#ede9fe", "#ddd6fe", "#c4b5fd",
  "#a78bfa", "#8b5cf6", "#7c3aed", "#f3e8ff", "#e9d5ff", "#d8b4fe",
  "#c084fc", "#a855f7", "#9333ea", "#fae8ff", "#f5d0fe", "#f0abfc",
  "#e879f9", "#d946ef", "#c026d3", "#fce7f3", "#fbcfe8", "#f9a8d4",
  "#f472b6", "#ec4899", "#db2777",
]

function isValidHex(value: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)
}

function normalizeHex(value: string): string {
  if (!value) return value
  const withHash = value.startsWith("#") ? value : `#${value}`
  if (/^#[0-9a-fA-F]{3}$/.test(withHash)) {
    return `#${withHash
      .slice(1)
      .split("")
      .map((c) => c + c)
      .join("")}`
  }
  return withHash
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const h = normalizeHex(hex)
  if (!isValidHex(h)) return null
  const v = h.slice(1)
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  }
}

function rgbToHex({ r, g, b }: { r: number; g: number; b: number }): string {
  const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

export interface ColorPickerProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "value" | "onChange" | "defaultValue"> {
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  /** Preset swatches to show. */
  presets?: string[]
  /** Show a HEX/RGB input. Defaults to true. */
  showInput?: boolean
  disabled?: boolean
  className?: string
  /** Show alpha slider. */
  showAlpha?: boolean
}

export const ColorPicker = React.forwardRef<HTMLDivElement, ColorPickerProps>(function ColorPicker(
  {
    value,
    defaultValue = "#000000",
    onChange,
    presets = PRESET_COLORS,
    showInput = true,
    disabled,
    className,
    showAlpha = false,
    ...rest
  },
  ref,
) {
  const isControlled = value !== undefined
  const [internal, setInternal] = React.useState<string>(defaultValue)
  const current = isControlled ? value ?? "#000000" : internal
  const rgb = React.useMemo(() => hexToRgb(current) ?? { r: 0, g: 0, b: 0 }, [current])

  const commit = React.useCallback(
    (next: string) => {
      const normalized = normalizeHex(next)
      if (!isControlled) setInternal(normalized)
      onChange?.(normalized)
    },
    [isControlled, onChange],
  )

  const handleSwatch = (color: string) => commit(color)

  const handleHexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value
    if (isValidHex(next) || isValidHex(`#${next}`)) commit(next)
  }

  const handleChannel = (channel: "r" | "g" | "b", raw: string) => {
    const n = Number(raw)
    if (Number.isNaN(n)) return
    const next = { ...rgb, [channel]: Math.max(0, Math.min(255, n)) }
    commit(rgbToHex(next))
  }

  return (
    <div
      ref={ref}
      data-component="color-picker"
      data-disabled={disabled ? true : undefined}
      className={cn("inline-flex items-center gap-2", className)}
      {...rest}
    >
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label="Open color picker"
            className={cn(
              "inline-flex h-9 w-12 items-center justify-center rounded-md border border-input bg-background p-1 text-foreground transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              disabled && "cursor-not-allowed opacity-50",
            )}
          >
            <span
              className="block h-full w-full rounded-sm border border-border"
              style={{ background: current }}
            />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-3">
          <div className="space-y-3">
            <div className="grid grid-cols-8 gap-1.5">
              {presets.map((color) => {
                const selected = normalizeHex(color).toLowerCase() === current.toLowerCase()
                return (
                  <button
                    key={color}
                    type="button"
                    onClick={() => handleSwatch(color)}
                    aria-label={`Use color ${color}`}
                    aria-pressed={selected}
                    className={cn(
                      "relative h-6 w-6 rounded-sm border border-border transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                    style={{ background: color }}
                  >
                    {selected ? (
                      <Check
                        className="absolute inset-0 m-auto h-3.5 w-3.5"
                        style={{
                          color: isValidHex(color) && hexToRgb(color)
                            ? (hexToRgb(color)!.r * 0.299 + hexToRgb(color)!.g * 0.587 + hexToRgb(color)!.b * 0.114 > 140
                              ? "#000"
                              : "#fff")
                            : "#fff",
                        }}
                      />
                    ) : null}
                  </button>
                )
              })}
            </div>
            {showInput ? (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs">
                  <span className="w-8 text-muted-foreground">HEX</span>
                  <input
                    type="text"
                    value={current}
                    onChange={handleHexChange}
                    className="h-8 w-full rounded border border-input bg-background px-2 font-mono text-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </label>
                <div className="grid grid-cols-3 gap-1 text-xs">
                  {(["r", "g", "b"] as const).map((channel) => (
                    <label key={channel} className="flex items-center gap-1">
                      <span className="w-3 uppercase text-muted-foreground">{channel}</span>
                      <input
                        type="number"
                        min={0}
                        max={255}
                        value={rgb[channel]}
                        onChange={(e) => handleChannel(channel, e.target.value)}
                        className="h-8 w-full rounded border border-input bg-background px-1 text-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      />
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
            {showAlpha ? (
              <input
                type="range"
                min={0}
                max={100}
                aria-label="Alpha"
                className="w-full"
              />
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
      {showInput ? (
        <input
          type="text"
          value={current}
          onChange={handleHexChange}
          disabled={disabled}
          className={cn(
            "h-9 w-24 rounded-md border border-input bg-background px-2 font-mono text-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            disabled && "cursor-not-allowed opacity-50",
          )}
        />
      ) : null}
      <button
        type="button"
        disabled={disabled}
        aria-label="Pick from screen"
        className={cn(
          "inline-flex h-9 w-9 items-center justify-center rounded-md border border-input bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <Pipette className="h-4 w-4" />
      </button>
    </div>
  )
})
