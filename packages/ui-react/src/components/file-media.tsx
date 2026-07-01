"use client"

import * as React from "react"

export type FileMediaKind = "image" | "audio" | "svg" | "binary"

export interface FileContent {
  name?: string
  contents?: string
  mimeType?: string
}

export interface FileMediaOptions {
  mode?: "auto" | "off"
  path?: string
  current?: unknown
  before?: unknown
  after?: unknown
  deleted?: boolean
  readFile?: (path: string) => Promise<FileContent | undefined>
  onLoad?: () => void
  onError?: (ctx: { kind: FileMediaKind }) => void
}

function mediaValue(cfg: FileMediaOptions, mode: "image" | "audio") {
  if (cfg.current !== undefined) return cfg.current
  if (mode === "image") return cfg.after ?? cfg.before
  return cfg.after ?? cfg.before
}

function mediaKindFromPath(path: string | undefined): FileMediaKind | undefined {
  if (!path) return undefined
  const lower = path.toLowerCase()
  if (/\.(png|jpe?g|gif|webp|avif|bmp|ico|heic|heif)$/.test(lower)) return "image"
  if (/\.(mp3|wav|ogg|m4a|flac|aac)$/.test(lower)) return "audio"
  if (/\.svg$/.test(lower)) return "svg"
  return undefined
}

function isBinaryContent(value: unknown): boolean {
  if (value == null) return false
  if (typeof value === "string") return false
  if (Array.isArray(value)) return false
  return true
}

function hasMediaValue(value: unknown): boolean {
  if (value == null) return false
  if (typeof value === "string") return value.length > 0
  if (Array.isArray(value)) return value.length > 0
  return true
}

function dataUrlFromMediaValue(value: unknown, kind: "image" | "audio" | "svg"): string | undefined {
  if (value == null) return undefined
  if (typeof value === "string") {
    if (value.startsWith("data:")) return value
    return `data:${kind === "image" ? "image/png" : kind === "audio" ? "audio/mpeg" : "image/svg+xml"};base64,${value}`
  }
  if (value instanceof Uint8Array) {
    let binary = ""
    for (const byte of value) binary += String.fromCharCode(byte)
    return `data:${kind === "image" ? "image/png" : kind === "audio" ? "audio/mpeg" : "image/svg+xml"};base64,${btoa(binary)}`
  }
  return undefined
}

function normalizeMimeType(mime?: string): string | undefined {
  return mime
}

function svgTextFromValue(value: unknown): string | undefined {
  if (typeof value === "string") return value
  return undefined
}

export interface FileMediaProps {
  media?: FileMediaOptions
  fallback: () => React.ReactNode
}

export const FileMedia: React.FC<FileMediaProps> = ({ media, fallback }) => {
  const cfg = () => media
  const kind = (): FileMediaKind | undefined => {
    const m = cfg()
    if (!m || m.mode === "off") return undefined
    return mediaKindFromPath(m.path)
  }

  const isBinary = (): boolean => {
    const m = cfg()
    if (!m || m.mode === "off") return false
    if (kind()) return false
    return isBinaryContent(m.current)
  }

  const deleted = (): boolean => {
    const m = cfg()
    const k = kind()
    if (!m || !k) return false
    if (m.deleted) return true
    if (k === "svg") return false
    if (m.current !== undefined) return false
    return !hasMediaValue(m.after) && hasMediaValue(m.before)
  }

  const [loaded, setLoaded] = React.useState<
    | { key: string; src?: string; mime?: string; error?: true }
    | undefined
  >(undefined)
  const [loading, setLoading] = React.useState(false)

  const direct = (() => {
    const m = cfg()
    const k = kind()
    if (!m || (k !== "image" && k !== "audio")) return undefined
    return dataUrlFromMediaValue(mediaValue(m, k), k)
  })()

  React.useEffect(() => {
    const m = cfg()
    const k = kind()
    if (!m || (k !== "image" && k !== "audio")) return
    if (m.current !== undefined) return
    if (deleted()) return
    if (direct) return
    if (!m.path || !m.readFile) return

    const key = `${k}:${m.path}`
    setLoading(true)
    let cancelled = false
    m.readFile(m.path).then(
      (result) => {
        if (cancelled) return
        const src = dataUrlFromMediaValue(result as unknown, k)
        if (!src) {
          m.onError?.({ kind: k })
          setLoaded({ key, error: true })
        } else {
          setLoaded({
            key,
            src,
            mime: k === "audio" ? normalizeMimeType(result?.mimeType) : undefined,
          })
        }
        setLoading(false)
      },
      () => {
        if (cancelled) return
        m.onError?.({ kind: k })
        setLoaded({ key, error: true })
        setLoading(false)
      },
    )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg()?.path, cfg()?.current, cfg()?.after, cfg()?.before, kind(), cfg()?.deleted])

  const remoteSrc = (() => {
    const m = cfg()
    const k = kind()
    if (!m || (k !== "image" && k !== "audio")) return undefined
    if (m.current !== undefined) return undefined
    if (deleted()) return undefined
    if (direct) return undefined
    const requestKey = `${k}:${m.path}`
    const value = loaded
    if (!value || value.key !== requestKey) return undefined
    return value
  })()

  const src = direct ?? (remoteSrc && "src" in remoteSrc ? remoteSrc.src : undefined)
  const status: "idle" | "loading" | "ready" | "error" = (() => {
    if (direct) return "ready"
    if (!cfg()?.readFile) return "idle"
    if (loading) return "loading"
    if (remoteSrc?.error) return "error"
    if (src) return "ready"
    return "idle"
  })()
  const audioMime = remoteSrc && "mime" in remoteSrc ? remoteSrc.mime : undefined

  const svgSource = (() => {
    const m = cfg()
    if (!m || kind() !== "svg") return undefined
    return svgTextFromValue(m.current)
  })()
  const svgSrc = (() => {
    const m = cfg()
    if (!m || kind() !== "svg") return undefined
    return dataUrlFromMediaValue(m.current, "svg")
  })()
  const svgInvalid = (() => {
    const m = cfg()
    if (!m || kind() !== "svg") return undefined
    if (svgSource !== undefined) return undefined
    if (!hasMediaValue(m.current)) return undefined
    return [m.path, m.current] as const
  })()

  React.useEffect(() => {
    if (!svgInvalid) return
    cfg()?.onError?.({ kind: "svg" })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svgInvalid?.[0], svgInvalid?.[1]])

  const kindLabel = (value: "image" | "audio") =>
    value === "image" ? "Image" : "Audio"

  const renderImageOrAudio = () => {
    if (!src) {
      const m = cfg()
      const k = kind()
      if (!m || (k !== "image" && k !== "audio")) return fallback()
      const label = kindLabel(k)
      if (deleted()) {
        return (
          <div className="flex min-h-40 items-center justify-center px-6 py-4 text-center text-text-weak">
            {`${label} removed`}
          </div>
        )
      }
      if (status === "loading") {
        return (
          <div className="flex min-h-40 items-center justify-center px-6 py-4 text-center text-text-weak">
            {`Loading ${label.toLowerCase()}...`}
          </div>
        )
      }
      if (status === "error") {
        return (
          <div className="flex min-h-40 items-center justify-center px-6 py-4 text-center text-text-weak">
            {`Error loading ${label.toLowerCase()}`}
          </div>
        )
      }
      return (
        <div className="flex min-h-40 items-center justify-center px-6 py-4 text-center text-text-weak">
          {`${label} unavailable`}
        </div>
      )
    }

    const k = kind()
    if (k !== "image" && k !== "audio") return fallback()
    if (k === "image") {
      return (
        <div className="flex justify-center bg-background-stronger px-6 py-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={cfg()?.path}
            className="max-h-[60vh] max-w-full rounded border border-border-weak-base bg-background-base object-contain"
            onLoad={() => cfg()?.onLoad?.()}
          />
        </div>
      )
    }

    return (
      <div className="flex justify-center bg-background-stronger px-6 py-4">
        <audio className="w-full max-w-xl" controls preload="metadata" onLoadedMetadata={() => cfg()?.onLoad?.()}>
          <source src={src} type={audioMime} />
        </audio>
      </div>
    )
  }

  if (kind() === "image" || kind() === "audio") {
    return <>{renderImageOrAudio()}</>
  }
  if (kind() === "svg") {
    if (svgSource === undefined && svgSrc == null) return <>{fallback()}</>
    return (
      <div className="flex flex-col gap-4 px-6 py-4">
        {svgSource !== undefined && fallback()}
        {svgSrc && (
          <div className="flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={svgSrc}
              alt={cfg()?.path}
              className="max-h-[60vh] max-w-full rounded border border-border-weak-base bg-background-base object-contain"
              onLoad={() => cfg()?.onLoad?.()}
            />
          </div>
        )}
      </div>
    )
  }
  if (isBinary()) {
    return (
      <div className="flex min-h-56 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
        <div className="text-14-semibold text-text-strong">
          {cfg()?.path?.split("/").pop() ?? "Binary file"}
        </div>
        <div className="text-14-regular text-text-weak">
          {cfg()?.path
            ? `Binary content for ${cfg()?.path}`
            : "Binary file preview unavailable"}
        </div>
      </div>
    )
  }
  return <>{fallback()}</>
}