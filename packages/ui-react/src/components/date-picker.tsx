import * as React from "react"
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"
import { cn } from "../lib/utils"

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function isSameDay(a: Date, b: Date | undefined): boolean {
  if (!b) return false
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function formatDate(d: Date | undefined, format: DateFormat): string {
  if (!d) return ""
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  switch (format) {
    case "yyyy-MM-dd":
      return `${y}-${m}-${day}`
    case "MM/dd/yyyy":
      return `${m}/${day}/${y}`
    case "dd/MM/yyyy":
      return `${day}/${m}/${y}`
    case "MMM d, yyyy":
      return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}, ${y}`
    case "MMMM d, yyyy":
      return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${y}`
  }
}

function parseDate(value: string, format: DateFormat): Date | undefined {
  if (!value) return undefined
  const parts = value.split(/[-/]/).map((p) => p.trim())
  if (parts.length !== 3) return undefined
  let y: number, m: number, d: number
  switch (format) {
    case "yyyy-MM-dd":
      ;[y, m, d] = [Number(parts[0]), Number(parts[1]), Number(parts[2])]
      break
    case "MM/dd/yyyy":
      ;[m, d, y] = [Number(parts[0]), Number(parts[1]), Number(parts[2])]
      break
    case "dd/MM/yyyy":
      ;[d, m, y] = [Number(parts[0]), Number(parts[1]), Number(parts[2])]
      break
    default:
      ;[y, m, d] = [Number(parts[0]), Number(parts[1]), Number(parts[2])]
  }
  if (!y || !m || !d) return undefined
  const date = new Date(y, m - 1, d)
  if (Number.isNaN(date.getTime())) return undefined
  return date
}

export type DateFormat = "yyyy-MM-dd" | "MM/dd/yyyy" | "dd/MM/yyyy" | "MMM d, yyyy" | "MMMM d, yyyy"

export interface DatePickerProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "value" | "onChange" | "defaultValue"> {
  value?: Date
  defaultValue?: Date
  onChange?: (date: Date | undefined) => void
  format?: DateFormat
  placeholder?: string
  disabled?: boolean
  /** Earliest selectable date. */
  min?: Date
  /** Latest selectable date. */
  max?: Date
  /** Locale for weekday / month names. Defaults to en-US. */
  locale?: string
  /** Show the inline popover trigger button. Defaults to true. */
  showTrigger?: boolean
}

const Calendar: React.FC<{
  selected?: Date
  onSelect: (date: Date) => void
  min?: Date
  max?: Date
  month: Date
  onMonthChange: (date: Date) => void
}> = ({ selected, onSelect, min, max, month, onMonthChange }) => {
  const year = month.getFullYear()
  const monthIndex = month.getMonth()
  const firstDay = new Date(year, monthIndex, 1)
  const firstWeekday = firstDay.getDay()
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()

  const today = startOfDay(new Date())

  const cells: (Date | null)[] = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, monthIndex, d))
  while (cells.length % 7 !== 0) cells.push(null)

  const isDisabled = (date: Date) => {
    if (min && date < startOfDay(min)) return true
    if (max && date > startOfDay(max)) return true
    return false
  }

  return (
    <div data-component="date-picker-calendar" className="w-[280px] p-3">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => onMonthChange(new Date(year, monthIndex - 1, 1))}
          className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-sm font-medium">
          {MONTHS[monthIndex]} {year}
        </div>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => onMonthChange(new Date(year, monthIndex + 1, 1))}
          className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
        {cells.map((cell, i) => {
          if (!cell) return <div key={`e-${i}`} />
          const disabled = isDisabled(cell)
          const selectedDay = isSameDay(cell, selected)
          const isToday = isSameDay(cell, today)
          return (
            <button
              key={cell.toISOString()}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(cell)}
              aria-label={cell.toDateString()}
              aria-pressed={selectedDay}
              className={cn(
                "inline-flex h-8 w-8 items-center justify-center rounded-full text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40",
                selectedDay && "bg-primary text-primary-foreground hover:bg-primary",
                isToday && !selectedDay && "border border-border",
              )}
            >
              {cell.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export const DatePicker = React.forwardRef<HTMLDivElement, DatePickerProps>(function DatePicker(
  {
    value,
    defaultValue,
    onChange,
    format = "yyyy-MM-dd",
    placeholder = "Select date",
    disabled,
    min,
    max,
    showTrigger = true,
    className,
    ...rest
  },
  ref,
) {
  const isControlled = value !== undefined
  const [internal, setInternal] = React.useState<Date | undefined>(defaultValue)
  const selected = isControlled ? value : internal

  const [open, setOpen] = React.useState(false)
  const [viewMonth, setViewMonth] = React.useState<Date>(selected ?? new Date())
  const [textValue, setTextValue] = React.useState<string>(formatDate(selected, format))
  const [textError, setTextError] = React.useState(false)

  React.useEffect(() => {
    if (selected) {
      setTextValue(formatDate(selected, format))
      setTextError(false)
    }
  }, [selected, format])

  const commit = React.useCallback(
    (date: Date | undefined) => {
      if (!isControlled) setInternal(date)
      onChange?.(date)
    },
    [isControlled, onChange],
  )

  const handleSelect = (date: Date) => {
    commit(date)
    setOpen(false)
  }

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value
    setTextValue(next)
    const parsed = parseDate(next, format)
    if (parsed) {
      setTextError(false)
      commit(parsed)
      setViewMonth(parsed)
    } else {
      setTextError(true)
    }
  }

  const trigger = (
    <div
      ref={ref}
      data-component="date-picker"
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
        value={textValue}
        placeholder={placeholder}
        disabled={disabled}
        onChange={handleTextChange}
        onBlur={() => {
          if (!textValue) {
            commit(undefined)
            setTextError(false)
          }
        }}
        className="h-full w-full border-0 bg-transparent outline-none placeholder:text-muted-foreground"
      />
      {showTrigger ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              aria-label="Open calendar"
              className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <CalendarIcon className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto p-0">
            <Calendar
              selected={selected}
              onSelect={handleSelect}
              month={viewMonth}
              onMonthChange={setViewMonth}
              min={min}
              max={max}
            />
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  )

  return trigger
})
