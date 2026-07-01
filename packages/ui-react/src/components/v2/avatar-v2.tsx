import * as React from "react"
import { cn } from "../../lib/utils"

const segmenter =
  typeof Intl !== "undefined" && typeof (Intl as unknown as { Segmenter?: unknown }).Segmenter !== "undefined"
    ? new (Intl as unknown as { Segmenter: new (l?: string, o?: { granularity: string }) => { segment: (s: string) => Iterable<{ segment: string }> } }).Segmenter(undefined, { granularity: "grapheme" })
    : undefined

function first(value: string): string {
  if (!value) return ""
  if (!segmenter) return Array.from(value)[0] ?? ""
  const iter = segmenter.segment(value)[Symbol.iterator]() as IterableIterator<{ segment: string }>
  const next = iter.next()
  return next.value?.segment ?? Array.from(value)[0] ?? ""
}

export interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  fallback: string
  src?: string
  background?: string
  foreground?: string
  size?: "small" | "normal" | "large"
  kind?: "user" | "org"
}

export const Avatar = React.forwardRef<HTMLDivElement, AvatarProps>(
  (
    {
      className,
      fallback,
      src,
      background,
      foreground,
      size = "large",
      kind = "user",
      style,
      ...rest
    },
    ref,
  ) => {
    const customStyle: React.CSSProperties = {
      ...(typeof style === "object" && style !== null ? style : {}),
      ...(!src && background ? { ["--avatar-bg" as any]: background } : {}),
      ...(!src && foreground ? { ["--avatar-fg" as any]: foreground } : {}),
    }
    return (
      <div
        ref={ref}
        data-component="avatar-v2"
        data-size={size}
        data-kind={kind}
        data-has-image={src ? "" : undefined}
        className={cn(className)}
        style={customStyle}
        {...rest}
      >
        {src ? (
          <img src={src} draggable={false} data-slot="avatar-image" alt={fallback} />
        ) : (
          first(fallback)
        )}
      </div>
    )
  },
)
Avatar.displayName = "Avatar"
