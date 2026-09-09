import * as React from "react"
import { cn } from "../../lib/utils.js"

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

export const PROJECT_AVATAR_VARIANTS = [
  "orange",
  "yellow",
  "cyan",
  "green",
  "red",
  "pink",
  "blue",
  "purple",
  "gray",
] as const

export type ProjectAvatarVariant = (typeof PROJECT_AVATAR_VARIANTS)[number]

export interface ProjectAvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  fallback: string
  src?: string
  variant?: ProjectAvatarVariant
  unread?: boolean
  loading?: boolean
}

export const ProjectAvatar = React.forwardRef<HTMLDivElement, ProjectAvatarProps>(
  (
    {
      className,
      fallback,
      src,
      variant = "gray",
      unread,
      loading,
      style,
      ...rest
    },
    ref,
  ) => {
    const mergedStyle: React.CSSProperties =
      typeof style === "object" && style !== null ? style : {}
    return (
      <div
        ref={ref}
        data-component="project-avatar-v2"
        data-unread={unread ? "" : undefined}
        className={cn(className)}
        style={mergedStyle}
        {...rest}
      >
        <div
          data-slot="project-avatar-surface"
          data-variant={variant}
          data-has-image={src ? "" : undefined}
          data-loading={loading ? "" : undefined}
        >
          {src ? (
            <img src={src} draggable={false} data-slot="project-avatar-image" alt={fallback} />
          ) : (
            first(fallback)
          )}
          {loading ? <span data-slot="project-avatar-loader" aria-hidden="true" /> : null}
        </div>
        {unread ? <span data-slot="project-avatar-unread-dot" aria-hidden="true" /> : null}
      </div>
    )
  },
)
ProjectAvatar.displayName = "ProjectAvatar"
