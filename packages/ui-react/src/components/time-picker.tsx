import * as React from "react"
import { Clock } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"
import { cn } from "../lib/utils"

export interface TimeValue {
  hours: number
  minutes: number
  seconds?: number
}

export type TimeFormat = "12" | "24"

export interface TimePickerProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "value" | "onChange" | "defaultValue"> {
  value?: TimeValue
  defaultValue?: TimeValue
  onChange?: (value: TimeValue) => void
  format?: TimeFormat
  /** Minute step. Defaults to 1. */
  step?: number
  /** Include seconds. Defaults to false. */
  showSeconds?: boolean
  placeholder?: string
  disabled?: boolean
  className?: string
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0")
}

function formatTime(value: TimeValue | undefined, format: TimeFormat, showSeconds: boolean): string {
  if (!value) return ""
  let h = value.hours
  const suffix = format === "12" ? (h >= 12 ? " PM" : " AM") : ""
  if (format === "12") {
    const hh = h % 12
    h = hh === 0 ? 12 : hh
  }
  const parts = [pad(h), pad(value.minutes)]
  if (showSeconds && value.seconds !== undefined) parts.push(pad(value.seconds))
  return `${parts.join(":")}${suffix}`
}

function parseTime(input: string, format: TimeFormat): TimeValue | undefined {
  const trimmed = input.trim()
  if (!trimmed) return undefined
  const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm|AM|PM)?$/)
  if (!match) return undefined
  let h = Number(match[1])
  const m = Number(match[2])
  const s = match[3] ? Number(match[3]) : 0
  const ampm = match[4]?.toLowerCase()
  if (Number.isNaN(h) || Number.isNaN(m) || Number.isNaN(s)) return undefined
  if (h < 0 || h > 24 || m < 0 || m > 59 || s < 0 || s > 59) return undefined

  if (format === "12") {
    if (!ampm) {
      // Default AM when ambiguous.
    } else if (ampm === "pm" && h < 12) {
      h += 12
    } else if (ampm === "am" && h === 12) {
      h = 0
    }
    if (h < 0 || h > 23) return undefined
  } else {
    if (h < 0 || h > 23) return undefined
  }
  return { hours: h, minutes: m, seconds: s }
}

const TimeColumn: React.FC<{
  values: number[]
  value?: number
  onSelect: (n: number) => void
  label: string
  padWidth?: number
}> = ({ values, value, onSelect, label, padWidth = 2 }) => {
  return (
    <div className="flex flex-col" role="listbox" aria-label={label}>
      <div className="border-b border-border px-2 py-1 text-center text-xs font-medium uppercase text-muted-foreground">
        {label}
      </div>
      <div className="max-h-48 overflow-y-auto py-1">
        {values.map((n) => {
          const selected = n === value
          return (
            <button
              key={n}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => onSelect(n)}
              className={cn(
                "block w-full px-3 py-1 text-center text-sm transition-colors hover:bg-muted focus:outline-none focus-visible:bg-muted",
                selected && "bg-primary text-primary-foreground hover:bg-primary",
              )}
            >
              {pad(n, padWidth)}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export const TimePicker = React.forwardRef<HTMLDivElement, TimePickerProps>(function TimePicker(
  {
    value,
    defaultValue,
    onChange,
    format = "24",
    step = 1,
    showSeconds = false,
    placeholder = "Select time",
    disabled,
    className,
    ...rest
  },
  ref,
) {
  const isControlled = value !== undefined
  const [internal, setInternal] = React.useState<TimeValue | undefined>(defaultValue)
  const current = isControlled ? value : internal
  const [open, setOpen] = React.useState(false)
  const [text, setText] = React.useState<string>(formatTime(current, format, showSeconds))
  const [textError, setTextError] = React.useState(false)

  React.useEffect(() => {
    if (current) {
      setText(formatTime(current, format, showSeconds))
      setTextError(false)
    }
  }, [current, format, showSeconds])

  const hours = React.useMemo(() => {
    if (format === "12") return Array.from({ length: 12 }, (_, i) => i + 1)
    return Array.from({ length: 24 }, (_, i) => i)
  }, [format])

  const minutes = React.useMemo(() => {
    const out: number[] = []
    for (let i = 0; i < 60; i += step) out.push(i)
    return out
  }, [step])

  const seconds = React.useMemo(() => {
    const out: number[] = []
    for (let i = 0; i < 60; i += step) out.push(i)
    return out
  }, [step])

  const commit = React.useCallback(
    (next: TimeValue) => {
      if (!isControlled) setInternal(next)
      onChange?.(next)
    },
    [isControlled, onChange],
  )

  const updatePart = (part: Partial<TimeValue>) => {
    const merged: TimeValue = {
      hours: part.hours ?? current?.hours ?? 0,
      minutes: part.minutes ?? current?.minutes ?? 0,
      seconds: part.seconds ?? current?.seconds ?? 0,
    }
    commit(merged)
  }

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value
    setText(next)
    const parsed = parseTime(next, format)
    if (parsed) {
      setTextError(false)
      commit({
        hours: parsed.hours,
        minutes: parsed.minutes,
        seconds: showSeconds ? parsed.seconds : 0,
      })
    } else {
      setTextError(true)
    }
  }

  return (
    <div
      ref={ref}
      data-component="time-picker"
      data-disabled={disabled ? true : undefined}
      data-error={textError ? true : undefined}
      className={cn(
        "inline-flex h-9 w-full items-center gap-2 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-within:ring-1 focus-within:ring-ring",
        disabled && "cursor-not-allowed opacity-50",
        textError && "border-destructive",
        className,
      )}
      {...rest}
    >
      <input
        type="text"
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        onChange={handleTextChange}
        className="h-full w-full border-0 bg-transparent outline-none placeholder:text-muted-foreground"
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label="Open time picker"
            className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Clock className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto p-0">
          <div className="flex divide-x divide-border">
            <TimeColumn
              values={hours}
              value={current?.hours}
              onSelect={(h) => updatePart({ hours: h })}
              label="Hours"
            />
            <TimeColumn
              values={minutes}
              value={current?.minutes}
              onSelect={(m) => updatePart({ minutes: m })}
              label="Minutes"
            />
            {showSeconds ? (
              <TimeColumn
                values={seconds}
                value={current?.seconds}
                onSelect={(s) => updatePart({ seconds: s })}
                label="Seconds"
              />
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
})
