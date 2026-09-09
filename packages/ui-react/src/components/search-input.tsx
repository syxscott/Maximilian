import * as React from "react"
import { Search, X } from "lucide-react"
import { cn } from "../lib/utils.js"

export interface SearchInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "size"> {
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  onClear?: () => void
  /** Show a leading search icon. Defaults to true. */
  showIcon?: boolean
  /** Show a clear (X) button when there's a value. Defaults to true. */
  clearable?: boolean
  /** Optional loading state, shows a spinner in place of the icon. */
  loading?: boolean
  size?: "sm" | "md" | "lg"
}

export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  {
    value,
    defaultValue,
    onChange,
    onClear,
    onKeyDown,
    showIcon = true,
    clearable = true,
    loading = false,
    size = "md",
    className,
    ...rest
  },
  ref,
) {
  const isControlled = value !== undefined
  const [internal, setInternal] = React.useState<string>(defaultValue ?? "")
  const current = isControlled ? value ?? "" : internal

  const handleChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!isControlled) setInternal(e.target.value)
      onChange?.(e.target.value)
    },
    [isControlled, onChange],
  )

  const handleClear = React.useCallback(() => {
    if (!isControlled) setInternal("")
    onChange?.("")
    onClear?.()
  }, [isControlled, onChange, onClear])

  const sizeClasses =
    size === "sm" ? "h-8 text-xs" : size === "lg" ? "h-11 text-base" : "h-9 text-sm"

  return (
    <div
      data-component="search-input"
      data-size={size}
      className={cn(
        "group relative inline-flex w-full items-center rounded-md border border-input bg-background text-foreground transition-colors focus-within:ring-1 focus-within:ring-ring",
        className,
      )}
    >
      {showIcon ? (
        <span
          aria-hidden="true"
          className="pointer-events-none flex h-full items-center pl-2.5 text-muted-foreground"
        >
          {loading ? (
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            <Search className="h-4 w-4" />
          )}
        </span>
      ) : null}
      <input
        ref={ref}
        type="search"
        role="searchbox"
        value={current}
        onChange={handleChange}
        onKeyDown={(e) => {
          if (e.key === "Escape" && current) {
            e.preventDefault()
            handleClear()
          }
          onKeyDown?.(e)
        }}
        className={cn(
          "h-full w-full border-0 bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground",
          sizeClasses,
          // Hide the browser-native search clear button.
          "[&::-webkit-search-cancel-button]:appearance-none",
        )}
        {...rest}
      />
      {clearable && current ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={handleClear}
          className="mr-1 inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  )
})
