"use client"

import * as React from "react"
import { cn } from "../lib/utils.js"
import {
  File as FileBase,
  useFileComponent,
  type FileProps,
  type DiffFileProps,
  type FileDiffMetadata,
  type FileContents,
  type PreloadMultiFileDiffResult,
  type PreloadFileDiffResult,
} from "./file.js"

type DiffPreload<T> = PreloadMultiFileDiffResult<T> | PreloadFileDiffResult<T>

type DiffPairPropsLite = {
  before?: FileContents
  after?: FileContents
  fileDiff?: undefined
}

type DiffPatchPropsLite = {
  fileDiff?: FileDiffMetadata
  before?: undefined
  after?: undefined
}

type SSRDiffFileProps<T> = (DiffPairPropsLite | DiffPatchPropsLite) & {
  preloadedDiff: DiffPreload<T>
  mode: "diff"
  className?: string
}

interface DiffSSRViewerProps {
  preloadedDiff: DiffPreload<unknown>
  fileDiff?: FileDiffMetadata
  before?: FileContents
  after?: FileContents
  className?: string
  [key: string]: unknown
}

const DIFFS_TAG_NAME = "diffs"

const DiffSSRViewer: React.FC<DiffSSRViewerProps> = (props) => {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const fileDiffRef = React.useRef<HTMLElement | null>(null)
  const FileComp = useFileComponent()

  React.useEffect(() => {
    if (typeof window === "undefined") return
    const fileDiffEl = fileDiffRef.current
    if (!fileDiffEl) return

    const scheme = window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light"
    fileDiffEl.setAttribute("color-scheme", scheme)

    return () => {
      fileDiffEl.removeAttribute("color-scheme")
    }
  }, [])

  const isServer = typeof window === "undefined"
  const prerenderedHTML = props.preloadedDiff?.prerenderedHTML ?? ""

  return (
    <div
      data-component="file"
      data-mode="diff"
      ref={containerRef}
      className={cn(props.className)}
    >
      <DIFFS_TAG_NAME_CUSTOM ref={fileDiffRef} id="ssr-diff">
        {isServer ? (
          <template
            // @ts-expect-error shadowrootmode is a valid HTML template attribute
            shadowrootmode="open"
            dangerouslySetInnerHTML={{ __html: prerenderedHTML }}
          />
        ) : (
          <FileComp
            {...({
              mode: "diff",
              fileDiff: props.fileDiff,
              before: props.before,
              after: props.after,
              preloadedDiff: props.preloadedDiff,
            } as unknown as React.ComponentProps<typeof FileComp>)}
          />
        )}
      </DIFFS_TAG_NAME_CUSTOM>
    </div>
  )
}

const DIFFS_TAG_NAME_CUSTOM = React.forwardRef<
  HTMLElement,
  React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }
>(({ children, ...rest }, ref) => {
  return React.createElement(DIFFS_TAG_NAME, { ...rest, ref }, children)
})
DIFFS_TAG_NAME_CUSTOM.displayName = "DiffsSSR"

export type FileSSRProps<T = unknown> = FileProps<T>

export function FileSSR<T>(props: FileSSRProps<T>): React.ReactElement {
  if (props.mode !== "diff" || !(props as { preloadedDiff?: unknown }).preloadedDiff) {
    return <FileBase {...(props as FileProps<unknown>)} />
  }
  const diffProps = props as unknown as DiffSSRViewerProps
  return <DiffSSRViewer {...diffProps} />
}