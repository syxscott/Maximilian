// @ts-nocheck
import React, { useMemo, useState, useEffect, useCallback, useRef } from "react"
import { Box, Text } from "ink"
import type { TuiPlugin, TuiPluginApi, TuiRouteCurrent } from "@opencode-ai/plugin/tui"
import type { SnapshotFileDiff, VcsFileDiff } from "@opencode-ai/sdk/v2"
import { LANGUAGE_EXTENSIONS } from "../../util/filetype"
import { useBindings, useCommandShortcut } from "../../keymap"
import { useTheme } from "../../context/theme"
import path from "path"
import { DiffViewerFileTree } from "./diff-viewer-file-tree"
import { Panel, PanelGroup, Separator } from "./diff-viewer-ui"
import { DialogSelect } from "../../ui/dialog-select"
import { getScrollAcceleration } from "../../util/scroll"
import {
  allExpandedFileTreeDirectories,
  buildFileTree,
  fileTreeFileSelection,
  type FileTreeRow,
  flattenFileTree,
  moveFileTreeSelection,
  moveFileTreeSelectionToFirstChild,
  moveFileTreeSelectionToParent,
  movePatchFileIndex,
  orderedPatchFileIndexes,
  setFileTreeDirectoryExpanded,
  showDiffViewerFileTree,
  singlePatchFileIndex,
  toggleFileTreeDirectory,
} from "./diff-viewer-file-tree-utils"

const ROUTE = "diff"
const MIN_SPLIT_WIDTH = 100
const FILE_TREE_WIDTH = 32
const PLAIN_TEXT_FILETYPE = "opencode-plain-text"
const WORKING_TREE_DIFF_CONTEXT_LINES = 12
const KV_SHOW_FILE_TREE = "diff_viewer_show_file_tree"
const KV_SINGLE_PATCH = "diff_viewer_single_patch"
const KV_VIEW = "diff_viewer_view"
type DiffMode = "git" | "last-turn"
type DiffViewerFocus = "patches" | "files"
type DiffView = "split" | "unified"
type SelectedHunk = { readonly fileIndex: number; readonly hunkIndex: number; readonly scrollTop: number }

type DiffFile = {
  readonly file: string
  readonly patch?: string
  readonly additions: number
  readonly deletions: number
  readonly status: "added" | "deleted" | "modified"
}

const normalizeDiffs = (diffs: readonly (VcsFileDiff | SnapshotFileDiff)[]): DiffFile[] =>
  diffs.flatMap((item) =>
    item.file
      ? [
          {
            file: item.file,
            patch: item.patch,
            additions: item.additions,
            deletions: item.deletions,
            status: item.status ?? "modified",
          } satisfies DiffFile,
        ]
      : [],
  )

function filetype(input?: string) {
  if (!input) return "none"
  const language = LANGUAGE_EXTENSIONS[path.extname(input)]
  if (["typescriptreact", "javascriptreact", "javascript"].includes(language)) return "typescript"
  return language
}

function storedView(value: unknown): DiffView | undefined {
  if (value === "split" || value === "unified") return value
}

function DiffViewer(props: { api: TuiPluginApi }) {
  const [terminalWidth, setTerminalWidth] = useState(80)
  const [terminalHeight, setTerminalHeight] = useState(24)
  const themeState = useTheme()
  const theme = props.api.theme.current
  const params = useMemo(() => {
    const current = props.api.route.current
    return ("params" in current ? current.params : undefined) as
      | {
          mode?: DiffMode
          sessionID?: string
          messageID?: string
          returnRoute?: TuiRouteCurrent
        }
      | undefined
  }, [props.api.route.current])
  const mode = params?.mode ?? "git"
  const diffInput = useMemo(() => {
    const sessionID = params?.sessionID
    return {
      mode,
      sessionID,
      messageID: params?.messageID,
      directory: sessionID ? props.api.state.session.get(sessionID)?.directory : undefined,
    }
  }, [params, mode])
  const [diffLoading, setDiffLoading] = useState(true)
  const [diffError, setDiffError] = useState<unknown>(undefined)
  const [diffData, setDiffData] = useState<DiffFile[]>([])
  const files = diffData
  const [focus, setFocus] = useState<DiffViewerFocus>("patches")
  const [fileTreeEnabled, setFileTreeEnabled] = useState(
    props.api.kv.get<boolean>(KV_SHOW_FILE_TREE, true) !== false,
  )
  const showFileTreeVal = useMemo(() => showDiffViewerFileTree(fileTreeEnabled, files.length), [fileTreeEnabled, files])
  const [singlePatch, setSinglePatch] = useState(props.api.kv.get<boolean>(KV_SINGLE_PATCH, false) === true)
  const patchPaneWidth = useMemo(() => terminalWidth - (showFileTreeVal ? 33 : 0) - 4, [terminalWidth, showFileTreeVal])
  const patchLeftBorder = useMemo(() => (showFileTreeVal ? ["left"] : []), [showFileTreeVal])
  const splitAvailable = useMemo(() => patchPaneWidth >= MIN_SPLIT_WIDTH, [patchPaneWidth])
  const defaultView = useMemo(() => {
    if (props.api.tuiConfig.diff_style === "stacked") return "unified"
    return splitAvailable ? "split" : "unified"
  }, [splitAvailable])
  const [viewOverride, setViewOverride] = useState<DiffView | undefined>(storedView(props.api.kv.get(KV_VIEW)))
  const view = useMemo(() => (splitAvailable ? (viewOverride ?? defaultView) : "unified"), [splitAvailable, viewOverride, defaultView])
  const fileTree = useMemo(() => buildFileTree(files), [files])
  const [expandedFileNodes, setExpandedFileNodes] = useState<ReadonlySet<number>>(new Set())
  const [highlightedFileNode, setHighlightedFileNode] = useState<number | undefined>()
  const [lastHighlightedFileNode, setLastHighlightedFileNode] = useState<number | undefined>()
  const [activePatchFileIndex, setActivePatchFileIndex] = useState<number | undefined>()
  const [selectedFileIndex, setSelectedFileIndex] = useState<number | undefined>()
  const [reviewedFileNames, setReviewedFileNames] = useState<ReadonlySet<string>>(new Set())
  const patchScrollAcceleration = useMemo(() => getScrollAcceleration(props.api.tuiConfig), [])
  const fileRows = useMemo(() => flattenFileTree(fileTree, expandedFileNodes), [fileTree, expandedFileNodes])
  const patchFileIndexes = useMemo(() => orderedPatchFileIndexes(flattenFileTree(fileTree)), [fileTree])
  const switchFocusShortcut = useCommandShortcut("diff.switch_focus")
  const nextHunkShortcut = useCommandShortcut("diff.next_hunk")
  const previousHunkShortcut = useCommandShortcut("diff.previous_hunk")
  const nextFileShortcut = useCommandShortcut("diff.next_file")
  const previousFileShortcut = useCommandShortcut("diff.previous_file")
  const toggleFileTreeShortcut = useCommandShortcut("diff.toggle_file_tree")
  const singlePatchShortcut = useCommandShortcut("diff.single_patch")
  const switchSourceShortcut = useCommandShortcut("diff.switch_source")
  const toggleViewShortcut = useCommandShortcut("diff.toggle_view")
  const markReviewedShortcut = useCommandShortcut("diff.mark_reviewed")
  const helpShortcut = useCommandShortcut("diff.help")
  const [selectedHunk, setSelectedHunk] = useState<SelectedHunk | undefined>()
  const [patchFillerHeight, setPatchFillerHeight] = useState(0)

  useEffect(() => {
    return () => {
      props.api.ui.dialog.clear()
    }
  }, [])

  // Fetch diff data
  useEffect(() => {
    let cancelled = false
    setDiffLoading(true)
    setDiffError(undefined)
    const fetch = async () => {
      try {
        if (diffInput.mode === "last-turn") {
          const sessionID = diffInput.sessionID
          if (!sessionID) {
            if (!cancelled) { setDiffData([]); setDiffLoading(false) }
            return
          }
          const result = await props.api.client.session.diff(
            { sessionID, messageID: diffInput.messageID },
            { throwOnError: true },
          )
          if (!cancelled) { setDiffData(normalizeDiffs(result.data ?? [])); setDiffLoading(false) }
        } else {
          const result = await props.api.client.vcs.diff(
            { directory: diffInput.directory, mode: "git", context: WORKING_TREE_DIFF_CONTEXT_LINES },
            { throwOnError: true },
          )
          if (!cancelled) { setDiffData(normalizeDiffs(result.data ?? [])); setDiffLoading(false) }
        }
      } catch (e) {
        if (!cancelled) { setDiffError(e); setDiffLoading(false) }
      }
    }
    void fetch()
    return () => { cancelled = true }
  }, [diffInput.mode, diffInput.sessionID, diffInput.messageID, diffInput.directory])

  // Reset state when diff data changes
  useEffect(() => {
    setExpandedFileNodes(allExpandedFileTreeDirectories(fileTree))
    setHighlightedFileNode(undefined)
    setLastHighlightedFileNode(undefined)
    setActivePatchFileIndex(undefined)
    setSelectedFileIndex(undefined)
    setSelectedHunk(undefined)
    setReviewedFileNames(new Set<string>())
  }, [fileTree])

  const ensureHighlightedFileNode = useCallback(() => {
    const highlighted = highlightedFileNode
    if (highlighted !== undefined && fileRows.some((row) => row.id === highlighted)) return
    const lastHighlighted = lastHighlightedFileNode
    const next =
      lastHighlighted !== undefined && fileRows.some((row) => row.id === lastHighlighted)
        ? lastHighlighted
        : fileRows.find((row) => row.fileIndex !== undefined)?.id
    setHighlightedFileNode(next)
  }, [highlightedFileNode, lastHighlightedFileNode, fileRows])

  const setHighlighted = useCallback((node: number | undefined) => {
    setHighlightedFileNode(node)
    if (node !== undefined) setLastHighlightedFileNode(node)
  }, [])

  const moveFileSelection = useCallback(
    (offset: number) => setHighlighted(moveFileTreeSelection(fileRows, highlightedFileNode, offset)),
    [fileRows, highlightedFileNode],
  )

  const clearFileTreePatchState = useCallback(() => {
    setHighlightedFileNode(undefined)
    setActivePatchFileIndex(undefined)
    setSelectedHunk(undefined)
  }, [])

  const revealFileTreeFile = useCallback(
    (fileIndex: number) => {
      const selection = fileTreeFileSelection(fileTree, fileIndex)
      if (!selection) return
      setExpandedFileNodes((expanded) => {
        const next = new Set(expanded)
        selection.expandedNodes.forEach((node) => next.add(node))
        return next
      })
      setHighlighted(selection.highlightedNode)
    },
    [fileTree],
  )

  const selectPatchFile = useCallback(
    (fileIndex: number) => {
      revealFileTreeFile(fileIndex)
      setActivePatchFileIndex(fileIndex)
      setSelectedFileIndex(fileIndex)
    },
    [revealFileTreeFile],
  )

  const currentPatchFileIndex = useCallback(() => {
    // In ink, scroll tracking is handled differently
    return undefined
  }, [])

  const highlightedPatchFileIndex = useCallback(
    () => fileRows.find((row) => row.id === highlightedFileNode)?.fileIndex,
    [fileRows, highlightedFileNode],
  )
  const firstPatchFileIndex = useCallback(
    () => fileRows.find((row) => row.fileIndex !== undefined)?.fileIndex,
    [fileRows],
  )

  const visiblePatchFiles = useMemo(() => {
    if (!singlePatch) {
      return patchFileIndexes.flatMap((fileIndex) => {
        const file = files[fileIndex]
        return file ? [{ file, fileIndex }] : []
      })
    }
    const fileIndex = singlePatchFileIndex(
      selectedFileIndex,
      activePatchFileIndex,
      currentPatchFileIndex(),
      firstPatchFileIndex(),
    )
    const file = fileIndex === undefined ? undefined : files[fileIndex]
    return file && fileIndex !== undefined ? [{ file, fileIndex }] : []
  }, [singlePatch, patchFileIndexes, files, selectedFileIndex, activePatchFileIndex, currentPatchFileIndex, firstPatchFileIndex])

  const jumpToFileIndex = useCallback(
    (fileIndex: number | undefined) => {
      if (fileIndex === undefined) return
      setSelectedHunk(undefined)
      selectPatchFile(fileIndex)
    },
    [selectPatchFile],
  )

  const jumpRelativePatchFile = useCallback(
    (offset: number) => {
      setSelectedHunk(undefined)
      const next = movePatchFileIndex(patchFileIndexes, selectedFileIndex ?? activePatchFileIndex, offset)
      if (next === undefined) return
      selectPatchFile(next)
    },
    [patchFileIndexes, selectedFileIndex, activePatchFileIndex, selectPatchFile],
  )

  const jumpRelativeHunk = useCallback(
    (offset: -1 | 1) => {
      // Ink does not have scroll position tracking like OpenTUI
      // This would need a custom scroll state implementation
    },
    [],
  )

  const toggleSelectedFileTreeRow = useCallback(() => {
    const highlighted = fileRows.find((row) => row.id === highlightedFileNode)
    if (highlighted?.fileIndex !== undefined) {
      jumpToFileIndex(highlighted.fileIndex)
      return
    }
    setExpandedFileNodes((expanded) => toggleFileTreeDirectory(fileTree, expanded, highlightedFileNode))
  }, [fileRows, highlightedFileNode, jumpToFileIndex, fileTree])

  const clickFileTreeRow = useCallback(
    (row: FileTreeRow) => {
      setFocus("files")
      setHighlighted(row.id)
      if (row.fileIndex !== undefined) {
        jumpToFileIndex(row.fileIndex)
        return
      }
      setExpandedFileNodes((expanded) => toggleFileTreeDirectory(fileTree, expanded, row.id))
    },
    [jumpToFileIndex, fileTree],
  )

  const toggleSelectedFileReviewed = useCallback(() => {
    const fileIndex =
      focus === "files"
        ? fileRows.find((row) => row.id === highlightedFileNode)?.fileIndex
        : (selectedFileIndex ?? activePatchFileIndex ?? currentPatchFileIndex())
    const file = fileIndex === undefined ? undefined : files[fileIndex]?.file
    if (!file) return
    setReviewedFileNames((reviewed) => {
      const next = new Set(reviewed)
      if (next.has(file)) next.delete(file)
      else next.add(file)
      return next
    })
  }, [focus, fileRows, highlightedFileNode, selectedFileIndex, activePatchFileIndex, currentPatchFileIndex, files])

  const focusRunner = (input: Record<DiffViewerFocus, () => void>) => () => input[focus]()

  const commands = useMemo(
    () => [
      {
        name: "diff.close",
        title: "Close diff viewer",
        category: "VCS",
        run() {
          const returnRoute = params?.returnRoute
          props.api.ui.dialog.clear()
          props.api.route.navigate(
            returnRoute?.name ?? "home",
            returnRoute && "params" in returnRoute ? returnRoute.params : undefined,
          )
        },
      },
      {
        name: "diff.down",
        title: "Move diff viewer down",
        category: "VCS",
        run: focusRunner({
          files() { moveFileSelection(1) },
          patches() { clearFileTreePatchState() },
        }),
      },
      {
        name: "diff.up",
        title: "Move diff viewer up",
        category: "VCS",
        run: focusRunner({
          files() { moveFileSelection(-1) },
          patches() { clearFileTreePatchState() },
        }),
      },
      {
        name: "diff.page.down",
        title: "Page diff viewer down",
        category: "VCS",
        run: focusRunner({
          files() { moveFileSelection(8) },
          patches() { clearFileTreePatchState() },
        }),
      },
      {
        name: "diff.page.up",
        title: "Page diff viewer up",
        category: "VCS",
        run: focusRunner({
          files() { moveFileSelection(-8) },
          patches() { clearFileTreePatchState() },
        }),
      },
      {
        name: "diff.toggle",
        title: "Toggle diff viewer item",
        category: "VCS",
        run: focusRunner({
          files() { toggleSelectedFileTreeRow() },
          patches() {},
        }),
      },
      {
        name: "diff.expand",
        title: "Expand diff viewer item",
        category: "VCS",
        run: focusRunner({
          files() {
            const highlighted = highlightedFileNode
            if (highlighted !== undefined && expandedFileNodes.has(highlighted)) {
              setHighlighted(moveFileTreeSelectionToFirstChild(fileRows, highlighted))
              return
            }
            setExpandedFileNodes((expanded) =>
              setFileTreeDirectoryExpanded(fileTree, expanded, highlightedFileNode, true),
            )
          },
          patches() {},
        }),
      },
      {
        name: "diff.expand_all",
        title: "Expand all diff viewer folders",
        category: "VCS",
        run: focusRunner({
          files() { setExpandedFileNodes(allExpandedFileTreeDirectories(fileTree)) },
          patches() {},
        }),
      },
      {
        name: "diff.collapse",
        title: "Collapse diff viewer item",
        category: "VCS",
        run: focusRunner({
          files() {
            const highlighted = highlightedFileNode
            const node = highlighted === undefined ? undefined : fileTree.nodes[highlighted]
            if (node?.kind !== "directory" || !expandedFileNodes.has(node.id)) {
              setHighlighted(moveFileTreeSelectionToParent(fileRows, highlighted))
              return
            }
            setExpandedFileNodes((expanded) =>
              setFileTreeDirectoryExpanded(fileTree, expanded, highlightedFileNode, false),
            )
          },
          patches() {},
        }),
      },
      {
        name: "diff.next_hunk",
        title: "Jump to next diff hunk",
        category: "VCS",
        run() { jumpRelativeHunk(1) },
      },
      {
        name: "diff.previous_hunk",
        title: "Jump to previous diff hunk",
        category: "VCS",
        run() { jumpRelativeHunk(-1) },
      },
      {
        name: "diff.next_file",
        title: "Jump to next diff file",
        category: "VCS",
        run() { jumpRelativePatchFile(1) },
      },
      {
        name: "diff.previous_file",
        title: "Jump to previous diff file",
        category: "VCS",
        run() { jumpRelativePatchFile(-1) },
      },
      {
        name: "diff.mark_reviewed",
        title: "Toggle selected diff file reviewed",
        category: "VCS",
        run() { toggleSelectedFileReviewed() },
      },
      {
        name: "diff.switch_focus",
        title: "Switch diff viewer focus",
        category: "VCS",
        run() {
          if (!showFileTreeVal) return
          setFocus((current) => {
            if (current === "files") return "patches"
            ensureHighlightedFileNode()
            return "files"
          })
        },
      },
      {
        name: "diff.toggle_file_tree",
        title: "Toggle diff viewer file tree",
        category: "VCS",
        run() {
          const next = !fileTreeEnabled
          if (!next) setFocus("patches")
          setFileTreeEnabled(next)
          props.api.kv.set(KV_SHOW_FILE_TREE, next)
        },
      },
      {
        name: "diff.single_patch",
        title: "Toggle single patch view",
        category: "VCS",
        run() {
          setSelectedHunk(undefined)
          if (!singlePatch) {
            setSinglePatch(true)
            props.api.kv.set(KV_SINGLE_PATCH, true)
            return
          }
          setSinglePatch(false)
          props.api.kv.set(KV_SINGLE_PATCH, false)
        },
      },
      {
        name: "diff.switch_source",
        title: "Switch diff viewer source",
        category: "VCS",
        run() { openSwitchDiffDialog() },
      },
      {
        name: "diff.toggle_view",
        title: "Toggle diff viewer split or unified view",
        category: "VCS",
        run() {
          if (!splitAvailable) return
          setSelectedHunk(undefined)
          const next = view === "split" ? "unified" : "split"
          setViewOverride(next)
          props.api.kv.set(KV_VIEW, next)
        },
      },
      {
        name: "diff.help",
        title: "Show more diff viewer shortcuts",
        category: "VCS",
        run() { openHelpDialog() },
      },
    ],
    [focus, fileRows, highlightedFileNode, expandedFileNodes, fileTree, showFileTreeVal, fileTreeEnabled, singlePatch, splitAvailable, view, selectedFileIndex, activePatchFileIndex],
  )

  const switchDiffOptions = useMemo(() => [
    {
      title: "Working tree",
      value: "git" as const,
      description: "Show current git changes",
    },
    {
      title: "Last turn",
      value: "last-turn" as const,
      description: "Show changes from the last assistant turn",
    },
  ], [])

  const openSwitchDiffDialog = useCallback(() => {
    props.api.ui.dialog.replace(() => (
      <DialogSelect
        title="Switch source"
        skipFilter={true}
        renderFilter={false}
        current={mode}
        options={switchDiffOptions.map((option) => ({
          ...option,
          onSelect(dialog: { clear: () => void }) {
            dialog.clear()
            props.api.route.navigate(ROUTE, {
              mode: option.value,
              sessionID: params?.sessionID,
              messageID: params?.messageID,
              returnRoute: params?.returnRoute,
            })
          },
        }))}
      />
    ))
  }, [mode, params, switchDiffOptions])

  const openHelpDialog = useCallback(() => {
    props.api.ui.dialog.replace(() => <DiffViewerHelpDialog />)
    props.api.ui.dialog.setSize("large")
  }, [])

  useBindings(() => ({
    commands,
    bindings: [
      { key: "j,down", cmd: "diff.down", desc: "Move diff viewer down" },
      { key: "k,up", cmd: "diff.up", desc: "Move diff viewer up" },
      { key: "pagedown,ctrl+f", cmd: "diff.page.down", desc: "Page diff viewer down" },
      { key: "pageup,ctrl+b", cmd: "diff.page.up", desc: "Page diff viewer up" },
      { key: "m", cmd: "diff.mark_reviewed", desc: "Mark selected file reviewed" },
      ...props.api.tuiConfig.keybinds.gather(
        "diff",
        commands.map((command) => command.name),
      ),
    ],
  }))

  return (
    <Box position="absolute" zIndex={2500} left={0} top={0} width={terminalWidth} height={terminalHeight}>
      <PanelGroup axis="y" width="100%" height="100%">
        <Panel border="none" flexShrink={0} padding={0} paddingLeft={1}>
          <Text color={theme.text}>Diff </Text>
          <Text color={theme.textMuted}>{mode === "last-turn" ? "last turn" : "working tree"}</Text>
          <Box flexGrow={1} />
          <Text color={theme.textMuted}>
            {files.length} {files.length === 1 ? "file" : "files"}
          </Text>
        </Panel>

        <Box flexGrow={1} minHeight={0}>
          {diffLoading ? (
            <>
              <Separator axis="x" />
              <Box flexGrow={1} paddingLeft={1}>
                <Text color={theme.textMuted}>Loading diff...</Text>
              </Box>
            </>
          ) : !diffLoading && files.length === 0 ? (
            <>
              <Separator axis="x" />
              <Box flexGrow={1} paddingLeft={1}>
                <Text color={theme.textMuted}>No diff!</Text>
              </Box>
            </>
          ) : !diffLoading && diffError ? (
            <>
              <Separator axis="x" />
              <Box flexGrow={1} paddingLeft={1}>
                <Text color={theme.error}>Failed to load diff</Text>
              </Box>
            </>
          ) : !diffLoading ? (
            <PanelGroup axis="x">
              {showFileTreeVal && (
                <DiffViewerFileTree
                  files={files}
                  loading={diffLoading}
                  error={diffError}
                  theme={theme}
                  focused={focus === "files"}
                  width={FILE_TREE_WIDTH}
                  highlightedNode={highlightedFileNode}
                  selectedFileIndex={selectedFileIndex}
                  reviewedFileNames={reviewedFileNames}
                  expandedNodes={expandedFileNodes}
                  onRowClick={clickFileTreeRow}
                />
              )}

              <Panel flexGrow={1} minHeight={0} border="none">
                <Separator axis="x" start={showFileTreeVal ? "edge-out" : undefined} />
                <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden">
                  {visiblePatchFiles.map((entry, index) => {
                    const reviewed = reviewedFileNames.has(entry.file.file)
                    return (
                      <Box key={entry.fileIndex} flexDirection="column">
                        {index !== 0 && <Separator axis="x" start={showFileTreeVal ? "edge" : undefined} />}
                        <Box
                          flexDirection="row"
                          gap={1}
                          flexShrink={0}
                          paddingLeft={1}
                          paddingRight={1}
                        >
                          <Text color={reviewed ? theme.textMuted : theme.text}>{entry.file.file}</Text>
                          <Box flexGrow={1} />
                          <Text color={reviewed ? theme.textMuted : theme.diffAdded}>
                            +{entry.file.additions}
                          </Text>
                          <Text color={reviewed ? theme.textMuted : theme.diffRemoved}>
                            -{entry.file.deletions}
                          </Text>
                        </Box>
                        <Separator axis="x" start={showFileTreeVal ? "edge" : undefined} />
                        {entry.file.patch ? (
                          <Box>
                            <Text color={reviewed ? theme.textMuted : theme.text} wrap="word">
                              {entry.file.patch}
                            </Text>
                          </Box>
                        ) : (
                          <Text color={theme.textMuted}>No patch available for this file.</Text>
                        )}
                      </Box>
                    )
                  })}
                  {patchFillerHeight > 0 && <Box height={patchFillerHeight} />}
                </Box>
                <Separator axis="x" start={showFileTreeVal ? "edge-in" : undefined} />
              </Panel>
            </PanelGroup>
          ) : null}
        </Box>

        <Panel flexShrink={0} gap={2} paddingLeft={1} border="none">
          {switchFocusShortcut() && (
            <Text color={theme.text}>
              {switchFocusShortcut()} <Text color={theme.textMuted}>focus file tree</Text>
            </Text>
          )}
          {nextFileShortcut() && (
            <Text color={theme.text}>
              {nextFileShortcut()} <Text color={theme.textMuted}>next file</Text>
            </Text>
          )}
          {nextHunkShortcut() && (
            <Text color={theme.text}>
              {nextHunkShortcut()} <Text color={theme.textMuted}>next hunk</Text>
            </Text>
          )}
          {previousHunkShortcut() && (
            <Text color={theme.text}>
              {previousHunkShortcut()} <Text color={theme.textMuted}>previous hunk</Text>
            </Text>
          )}
          {previousFileShortcut() && (
            <Text color={theme.text}>
              {previousFileShortcut()} <Text color={theme.textMuted}>previous file</Text>
            </Text>
          )}
          {switchSourceShortcut() && (
            <Text color={theme.text}>
              {switchSourceShortcut()} <Text color={theme.textMuted}>switch source</Text>
            </Text>
          )}
          {markReviewedShortcut() && (
            <Text color={theme.text}>
              {markReviewedShortcut()} <Text color={theme.textMuted}>mark reviewed</Text>
            </Text>
          )}
          {helpShortcut() && (
            <Text color={theme.text}>
              {helpShortcut()} <Text color={theme.textMuted}>all</Text>
            </Text>
          )}
        </Panel>
      </PanelGroup>
    </Box>
  )
}

function DiffViewerHelpDialog() {
  const { theme } = useTheme()
  const rows = [
    {
      shortcut: () => "q",
      action: "Close viewer",
      description: "Quit the diff viewer",
    },
    {
      shortcut: useCommandShortcut("diff.switch_focus"),
      action: "Focus file tree",
      description: "Move keyboard focus between the file tree and patch pane",
    },
    {
      shortcut: useCommandShortcut("diff.next_hunk"),
      action: "Next hunk",
      description: "Jump to the next diff hunk",
    },
    {
      shortcut: useCommandShortcut("diff.previous_hunk"),
      action: "Previous hunk",
      description: "Jump to the previous diff hunk",
    },
    {
      shortcut: useCommandShortcut("diff.next_file"),
      action: "Next file",
      description: "Select the next changed file in file-tree order",
    },
    {
      shortcut: useCommandShortcut("diff.previous_file"),
      action: "Previous file",
      description: "Select the previous changed file in file-tree order",
    },
    {
      shortcut: useCommandShortcut("diff.toggle_file_tree"),
      action: "Toggle file tree",
      description: "Show or hide the file tree sidebar",
    },
    {
      shortcut: useCommandShortcut("diff.single_patch"),
      action: "Toggle patches",
      description: "Switch between one selected patch and all patches",
    },
    {
      shortcut: useCommandShortcut("diff.switch_source"),
      action: "Switch source",
      description: "Choose working tree or last-turn changes",
    },
    {
      shortcut: useCommandShortcut("diff.toggle_view"),
      action: "Toggle view",
      description: "Switch between split and unified diff layout",
    },
    {
      shortcut: useCommandShortcut("diff.expand_all"),
      action: "Expand all folders",
      description: "Open every folder in the file tree",
    },
    {
      shortcut: useCommandShortcut("diff.mark_reviewed"),
      action: "Mark reviewed",
      description: "Toggle reviewed state for the selected file",
    },
  ]

  return (
    <Box paddingLeft={2} paddingRight={2} paddingBottom={1} flexDirection="column" gap={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold color={theme.text}>
          Diff shortcuts
        </Text>
        <Text color={theme.textMuted}>esc</Text>
      </Box>
      <Box flexDirection="row">
        <Text color={theme.textMuted} width={5} wrap="truncate-end">
          Key
        </Text>
        <Text color={theme.textMuted} width={22} wrap="truncate-end">
          Action
        </Text>
        <Text color={theme.textMuted}>Description</Text>
      </Box>
      {rows.map((row, index) => (
        <Box key={index} flexDirection="row">
          <Text color={theme.text} width={5} wrap="truncate-end">
            {row.shortcut() || "-"}
          </Text>
          <Text color={theme.text} width={22} wrap="truncate-end">
            {row.action}
          </Text>
          <Text color={theme.textMuted}>{row.description}</Text>
        </Box>
      ))}
    </Box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.route.register([
    {
      name: ROUTE,
      render: () => <DiffViewer api={api} />,
    },
  ])

  api.keymap.registerLayer({
    commands: [
      {
        name: "diff.open",
        title: "Open diff viewer",
        slashName: "diff",
        category: "VCS",
        namespace: "palette",
        run() {
          api.route.navigate(ROUTE, {
            mode: "git",
            sessionID: "params" in api.route.current ? api.route.current.params?.sessionID : undefined,
            returnRoute: api.route.current,
          })
          api.ui.dialog.clear()
        },
      },
    ],
  })
}

export default {
  id: "diff-viewer",
  tui,
}
