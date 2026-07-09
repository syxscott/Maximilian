"use client"

import * as React from "react"
import { cn } from "../lib/utils.js"
import { FileMedia, type FileMediaOptions, type FileContent } from "./file-media.js"

/**
 * React port of OpenCode's file.tsx. The diff rendering pipeline is delegated
 * to a `FileComponent` provided by the host application via context, since
 * `@pierre/diffs` does not have first-class React 19 bindings. Consumers
 * should supply a viewer compatible with `DiffFileProps` / `TextFileProps`.
 */

export type FileSearchHandle = {
  focus: () => void
}

export type FileSearchControl = {
  register: (handle: FileSearchHandle | null) => void
}

export interface FileContents {
  name?: string
  contents?: string | string[]
  cacheKey?: string
}

export interface FileOptions<_T = unknown> {
  file?: FileContents
  hunkSeparators?: string
  disableLineNumbers?: boolean
  lineDiffType?: string
  maxLineDiffLength?: number
  tokenizeMaxLineLength?: number
  diffStyle?: "unified" | "split"
}

export interface FileDiffMetadata {
  file?: string
  patch?: string
  before?: string
  after?: string
}

export interface FileDiffOptions<_T = unknown> extends FileOptions<_T> {
  fileDiff?: FileDiffMetadata
  before?: FileContents
  after?: FileContents
}

export interface LineAnnotation<_T = unknown> {
  line: number
  side?: "deletions" | "additions"
  render?: (data: _T) => React.ReactNode
}

export interface DiffLineAnnotation<_T = unknown> {
  line: number
  side: "deletions" | "additions"
  render?: (data: _T) => React.ReactNode
}

export interface SelectedLineRange {
  start: number
  end: number
  side?: "deletions" | "additions"
  endSide?: "deletions" | "additions"
}

export type PreloadMultiFileDiffResult<_T = unknown> = {
  prerenderedHTML: string
  options: Record<string, unknown>
  annotations: Array<unknown>
}

export type PreloadFileDiffResult<_T = unknown> = {
  prerenderedHTML: string
  options: Record<string, unknown>
}

export interface SharedProps<_T = unknown> {
  annotations?: Array<LineAnnotation<_T> | DiffLineAnnotation<_T>>
  selectedLines?: SelectedLineRange | null
  commentedLines?: SelectedLineRange[]
  onLineNumberSelectionEnd?: (selection: SelectedLineRange | null) => void
  onRendered?: () => void
  className?: string
  classList?: Record<string, boolean | undefined>
  media?: FileMediaOptions
  search?: FileSearchControl
}

export interface TextFileProps<T = unknown> extends FileOptions<T>, SharedProps<T> {
  mode: "text"
  file: FileContents
  annotations?: LineAnnotation<T>[]
  preloadedDiff?: PreloadMultiFileDiffResult<T>
}

interface DiffPairProps<T = unknown> extends FileDiffOptions<T>, SharedProps<T> {
  mode: "diff"
  annotations?: DiffLineAnnotation<T>[]
  preloadedDiff?: PreloadMultiFileDiffResult<T> | PreloadFileDiffResult<T>
  virtualize?: boolean
  before: FileContents
  after: FileContents
  fileDiff?: undefined
}

interface DiffPatchProps<T = unknown> extends FileDiffOptions<T>, SharedProps<T> {
  mode: "diff"
  annotations?: DiffLineAnnotation<T>[]
  preloadedDiff?: PreloadMultiFileDiffResult<T> | PreloadFileDiffResult<T>
  virtualize?: boolean
  fileDiff: FileDiffMetadata
  before?: undefined
  after?: undefined
}

export type DiffFileProps<T = unknown> = DiffPairProps<T> | DiffPatchProps<T>

export type FileProps<T = unknown> = TextFileProps<T> | DiffFileProps<T>

/**
 * The File component itself relies on a heavy diff rendering pipeline that
 * doesn't have first-class React 19 bindings. Consumers should inject their
 * own viewer via a React context (FileContext).
 */
export type FileComponent = <T = unknown>(props: FileProps<T>) => React.ReactNode

export interface FileContextValue {
  FileComponent: FileComponent
}

const FileContext = React.createContext<FileContextValue | null>(null)

export const FileContextProvider: React.FC<{
  value: FileContextValue
  children: React.ReactNode
}> = ({ value, children }) => {
  return <FileContext.Provider value={value}>{children}</FileContext.Provider>
}

export const useFileComponent = (): FileComponent => {
  const ctx = React.useContext(FileContext)
  if (ctx?.FileComponent) return ctx.FileComponent
  // Fallback: render a placeholder so the UI doesn't crash when no viewer is
  // provided. Hosts should provide a real FileComponent for production use.
  const Fallback: FileComponent = (props) => {
    return (
      <div
        data-component="file"
        data-mode={props.mode}
        className={cn("relative outline-none p-4", props.className)}
      >
        <FileMedia
          media={props.media}
          fallback={() => (
            <pre className="text-12-regular text-text-weak whitespace-pre-wrap">
              {props.mode === "text"
                ? String((props as TextFileProps).file?.contents ?? "")
                : JSON.stringify((props as DiffFileProps).fileDiff ?? (props as DiffFileProps).before, null, 2)}
            </pre>
          )}
        />
      </div>
    )
  }
  return Fallback
}

export const File: <T = unknown>(props: FileProps<T>) => React.ReactElement = (props) => {
  const FileComp = useFileComponent()
  if (props.mode === "text") {
    return (
      <FileMedia
        media={props.media}
        fallback={() => <FileComp {...props} />}
      />
    ) as React.ReactElement
  }
  return (
    <FileMedia
      media={props.media}
      fallback={() => <FileComp {...props} />}
    />
  ) as React.ReactElement
}

// Re-export file-content type for downstream consumers
export type { FileContent }