import { forwardRef, type HTMLAttributes, type CSSProperties } from "react"

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : undefined

function first(value: string) {
  if (!value) return ""
  if (!segmenter) return Array.from(value)[0] ?? ""
  const it = segmenter.segment(value)[Symbol.iterator]()
  const next = it.next()
  if (next.done) return Array.from(value)[0] ?? ""
  return next.value.segment ?? Array.from(value)[0] ?? ""
}

export interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
  fallback: string
  src?: string
  background?: string
  foreground?: string
  size?: "small" | "normal" | "large"
}

export const Avatar = forwardRef<HTMLDivElement, AvatarProps>(
  (
    { fallback, src, background, foreground, size = "normal", className, style, ...rest },
    ref
  ) => {
    const mergedStyle: CSSProperties = {
      ...(typeof style === "object" && style ? style : {}),
      ...(!src && background ? { "--avatar-bg": background } : {}),
      ...(!src && foreground ? { "--avatar-fg": foreground } : {}),
    }
    return (
      <div
        ref={ref}
        data-component="avatar"
        data-size={size}
        data-has-image={src ? "" : undefined}
        className={className}
        style={mergedStyle}
        {...rest}
      >
        {src ? (
          <img src={src} draggable={false} data-slot="avatar-image" alt="" />
        ) : (
          <span data-slot="avatar-fallback">{first(fallback)}</span>
        )}
      </div>
    )
  }
)
Avatar.displayName = "Avatar"
