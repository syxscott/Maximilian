// @ts-nocheck
/**
 * PermissionPrompt: interactive permission gate for tool execution.
 *
 * Ported from OpenCode's SolidJS `permission.tsx`. The original used
 * `createStore`, `<Switch>/<Match>`, `<For>`, `<Show>`, `<Portal>`,
 * `useBindings`, `useTerminalDimensions`, `<diff>`, `<scrollbox>`,
 * `<textarea>`, and `SplitBorder` from `@opentui/core`.
 *
 * We port to React `useState`, conditional JSX, `.map()`, and ink `Box`/`Text`.
 * Several OpenTUI-specific features are simplified:
 *   - Diff viewer: rendered as raw text (no syntax highlighting).
 *   - Scrollbox: replaced by a plain Box.
 *   - Textarea: replaced by a simple text prompt.
 *   - Portal: removed (ink has no portal concept).
 *   - SplitBorder: replaced by ink's `borderStyle`.
 *   - useBindings: replaced by `useInput` from ink.
 */

import React, { useMemo, useState } from "react"
import { Box, Text, useInput } from "ink"
import { dirname } from "node:path"
import { useTheme, selectedForeground } from "../../context/theme"
import { useSDK } from "../../context/sdk"
import { useSync } from "../../context/sync"
import { useProject } from "../../context/project"
import { Locale } from "../../util/locale"
import { webSearchProviderLabel } from "../../util/tool-display"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PermissionRequest = {
  id: string
  sessionID: string
  permission: string
  always: string[]
  patterns?: string[]
  metadata?: Record<string, unknown>
  tool?: { messageID: string; callID: string }
}

type PermissionStage = "permission" | "always" | "reject"

// ---------------------------------------------------------------------------
// Local helpers (stubs for missing dependencies)
// ---------------------------------------------------------------------------

function usePathFormatter() {
  return {
    format(p?: string) {
      return p ?? ""
    },
  }
}

// ---------------------------------------------------------------------------
// EditBody
// ---------------------------------------------------------------------------

function EditBody(props: { request: PermissionRequest }) {
  const { theme } = useTheme()

  const filepath = useMemo(() => {
    const value = props.request.metadata?.filepath
    return typeof value === "string" ? value : ""
  }, [props.request.metadata?.filepath])

  const diff = useMemo(() => {
    const value = props.request.metadata?.diff
    return typeof value === "string" ? value : ""
  }, [props.request.metadata?.diff])

  return (
    <Box flexDirection="column">
      {diff ? (
        <Box paddingLeft={1}>
          <Text color={theme.text}>{diff}</Text>
        </Box>
      ) : (
        <Box paddingLeft={1}>
          <Text dimColor>No diff provided</Text>
        </Box>
      )}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// TextBody
// ---------------------------------------------------------------------------

function TextBody(props: { title: string; description?: string; icon?: string }) {
  const { theme } = useTheme()
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1} paddingLeft={1}>
        {props.icon ? <Text dimColor>{props.icon}</Text> : null}
        <Text dimColor>{props.title}</Text>
      </Box>
      {props.description ? (
        <Box paddingLeft={1}>
          <Text color={theme.text}>{props.description}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// RejectPrompt
// ---------------------------------------------------------------------------

function RejectPrompt(props: { onConfirm: (message: string) => void; onCancel: () => void }) {
  const { theme } = useTheme()
  const [value, setValue] = useState("")

  useInput((input, key) => {
    if (key.escape) {
      props.onCancel()
      return
    }
    if (key.return) {
      props.onConfirm(value)
      return
    }
    if (key.backspace || key.delete) {
      setValue((prev) => prev.slice(0, -1))
      return
    }
    if (input && !key.ctrl && !key.meta) {
      setValue((prev) => prev + input)
    }
  })

  return (
    <Box
      flexDirection="column"
      paddingLeft={1}
      paddingRight={3}
      paddingTop={1}
      paddingBottom={1}
      borderStyle="single"
      borderColor={theme.error}
    >
      <Box flexDirection="row" gap={1} paddingLeft={1}>
        <Text color={theme.error}>!</Text>
        <Text color={theme.text}>Reject permission</Text>
      </Box>
      <Box paddingLeft={1}>
        <Text dimColor>Tell OpenCode what to do differently</Text>
      </Box>
      <Box paddingLeft={1} paddingTop={1}>
        <Text color={theme.text}>
          {value}
          <Text color={theme.primary}>_</Text>
        </Text>
      </Box>
      <Box flexDirection="row" gap={2} paddingTop={1}>
        <Text>
          enter <Text dimColor>confirm</Text>
        </Text>
        <Text>
          esc <Text dimColor>cancel</Text>
        </Text>
      </Box>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Prompt (generic option selector)
// ---------------------------------------------------------------------------

function Prompt<const T extends Record<string, string>>(props: {
  title: string
  header?: React.ReactNode
  body: React.ReactNode
  options: T
  escapeKey?: keyof T
  onSelect: (option: keyof T) => void
}) {
  const { theme } = useTheme()
  const keys = Object.keys(props.options) as (keyof T)[]
  const [selected, setSelected] = useState(keys[0])

  useInput((input, key) => {
    if (key.left || input === "h") {
      setSelected((prev) => {
        const idx = keys.indexOf(prev)
        return keys[(idx - 1 + keys.length) % keys.length]
      })
      return
    }
    if (key.right || input === "l") {
      setSelected((prev) => {
        const idx = keys.indexOf(prev)
        return keys[(idx + 1) % keys.length]
      })
      return
    }
    if (key.return) {
      props.onSelect(selected)
      return
    }
    if (key.escape && props.escapeKey) {
      props.onSelect(props.escapeKey)
    }
  })

  return (
    <Box
      flexDirection="column"
      paddingLeft={1}
      paddingRight={3}
      paddingTop={1}
      paddingBottom={1}
      borderStyle="single"
      borderColor={theme.warning}
    >
      {props.header ?? (
        <Box flexDirection="row" gap={1} paddingLeft={1} flexShrink={0}>
          <Text color={theme.warning}>!</Text>
          <Text color={theme.text}>{props.title}</Text>
        </Box>
      )}
      {props.body}
      <Box flexDirection="row" flexShrink={0} gap={1} paddingTop={1}>
        {keys.map((option) => (
          <Box key={option as string} paddingLeft={1} paddingRight={1}>
            <Text
              color={option === selected ? selectedForeground(theme, theme.warning) : undefined}
              dimColor={option !== selected}
            >
              {props.options[option]}
            </Text>
          </Box>
        ))}
      </Box>
      <Box flexDirection="row" gap={2} paddingTop={1}>
        <Text>
          <Text dimColor>select</Text>
        </Text>
        <Text>
          enter <Text dimColor>confirm</Text>
        </Text>
      </Box>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// PermissionPrompt
// ---------------------------------------------------------------------------

export function PermissionPrompt(props: { request: PermissionRequest; directory?: string }) {
  const sdk = useSDK()
  const project = useProject()
  const sync = useSync()
  const [stage, setStage] = useState<PermissionStage>("permission")
  const pathFormatter = usePathFormatter()
  const { theme } = useTheme()

  const session = useMemo(
    () =>
      (sync.data.session as Array<{ id: string; parentID?: string }>).find(
        (s) => s.id === props.request.sessionID,
      ),
    [sync.data.session, props.request.sessionID],
  )

  const input = useMemo(() => {
    const tool = props.request.tool
    if (!tool) return {}
    const parts = ((sync.data.part as Record<string, unknown[]>)?.[tool.messageID] ?? []) as Array<
      Record<string, unknown>
    >
    for (const part of parts) {
      if (
        part.type === "tool" &&
        (part as Record<string, unknown>).callID === tool.callID &&
        (part.state as Record<string, unknown>)?.status !== "pending"
      ) {
        return ((part.state as Record<string, unknown>)?.input ?? {}) as Record<string, unknown>
      }
    }
    return {}
  }, [props.request.tool, sync.data.part])

  // -- "always" stage ---------------------------------------------------------
  if (stage === "always") {
    return (
      <Prompt
        title="Always allow"
        body={
          props.request.always.length === 1 && props.request.always[0] === "*" ? (
            <TextBody
              title={
                "This will allow " + props.request.permission + " until OpenCode is restarted."
              }
            />
          ) : (
            <Box paddingLeft={1} gap={1} flexDirection="column">
              <Text dimColor>
                This will allow the following patterns until OpenCode is restarted
              </Text>
              {props.request.always.map((pattern) => (
                <Text key={pattern} color={theme.text}>
                  - {pattern}
                </Text>
              ))}
            </Box>
          )
        }
        options={{ confirm: "Confirm", cancel: "Cancel" }}
        escapeKey="cancel"
        onSelect={(option) => {
          setStage("permission")
          if (option === "cancel") return
          void sdk.client.permission?.reply?.({
            reply: "always",
            requestID: props.request.id,
            directory: props.directory,
            workspace: project.workspace.current(),
          })
        }}
      />
    )
  }

  // -- "reject" stage ---------------------------------------------------------
  if (stage === "reject") {
    return (
      <RejectPrompt
        onConfirm={(message) => {
          void sdk.client.permission?.reply?.({
            reply: "reject",
            requestID: props.request.id,
            directory: props.directory,
            message: message || undefined,
            workspace: project.workspace.current(),
          })
        }}
        onCancel={() => {
          setStage("permission")
        }}
      />
    )
  }

  // -- "permission" stage (default) -------------------------------------------
  const info = (() => {
    const permission = props.request.permission
    const data = input

    if (permission === "edit") {
      const raw = props.request.metadata?.filepath
      const filepath = typeof raw === "string" ? raw : ""
      return {
        icon: "->",
        title: `Edit ${pathFormatter.format(filepath)}`,
        body: <EditBody request={props.request} />,
      }
    }

    if (permission === "read") {
      const raw = data.filePath
      const filePath = typeof raw === "string" ? raw : ""
      return {
        icon: "->",
        title: `Read ${pathFormatter.format(filePath)}`,
        body: filePath ? (
          <Box paddingLeft={1}>
            <Text dimColor>{"Path: " + pathFormatter.format(filePath)}</Text>
          </Box>
        ) : null,
      }
    }

    if (permission === "glob") {
      const pattern = typeof data.pattern === "string" ? data.pattern : ""
      return {
        icon: "*",
        title: `Glob "${pattern}"`,
        body: pattern ? (
          <Box paddingLeft={1}>
            <Text dimColor>{"Pattern: " + pattern}</Text>
          </Box>
        ) : null,
      }
    }

    if (permission === "grep") {
      const pattern = typeof data.pattern === "string" ? data.pattern : ""
      return {
        icon: "*",
        title: `Grep "${pattern}"`,
        body: pattern ? (
          <Box paddingLeft={1}>
            <Text dimColor>{"Pattern: " + pattern}</Text>
          </Box>
        ) : null,
      }
    }

    if (permission === "list") {
      const raw = data.path
      const dir = typeof raw === "string" ? raw : ""
      return {
        icon: "->",
        title: `List ${pathFormatter.format(dir)}`,
        body: dir ? (
          <Box paddingLeft={1}>
            <Text dimColor>{"Path: " + pathFormatter.format(dir)}</Text>
          </Box>
        ) : null,
      }
    }

    if (permission === "bash") {
      const title =
        typeof data.description === "string" && data.description
          ? data.description
          : "Shell command"
      const command = typeof data.command === "string" ? data.command : ""
      return {
        icon: "#",
        title,
        body: command ? (
          <Box paddingLeft={1}>
            <Text color={theme.text}>{"$ " + command}</Text>
          </Box>
        ) : null,
      }
    }

    if (permission === "task") {
      const type = typeof data.subagent_type === "string" ? data.subagent_type : "Unknown"
      const desc = typeof data.description === "string" ? data.description : ""
      return {
        icon: "#",
        title: `${Locale.titlecase(type)} Task`,
        body: desc ? (
          <Box paddingLeft={1}>
            <Text color={theme.text}>{"> " + desc}</Text>
          </Box>
        ) : null,
      }
    }

    if (permission === "webfetch") {
      const url = typeof data.url === "string" ? data.url : ""
      return {
        icon: "%",
        title: `WebFetch ${url}`,
        body: url ? (
          <Box paddingLeft={1}>
            <Text dimColor>{"URL: " + url}</Text>
          </Box>
        ) : null,
      }
    }

    if (permission === "websearch") {
      const query = typeof data.query === "string" ? data.query : ""
      return {
        icon: "D",
        title: `${webSearchProviderLabel(data.provider)} "${query}"`,
        body: query ? (
          <Box paddingLeft={1}>
            <Text dimColor>{"Query: " + query}</Text>
          </Box>
        ) : null,
      }
    }

    if (permission === "external_directory") {
      const meta = props.request.metadata ?? {}
      const parent = typeof meta["parentDir"] === "string" ? meta["parentDir"] : undefined
      const filepath = typeof meta["filepath"] === "string" ? meta["filepath"] : undefined
      const pattern = props.request.patterns?.[0]
      const derived =
        typeof pattern === "string"
          ? pattern.includes("*")
            ? dirname(pattern)
            : pattern
          : undefined

      const raw = parent ?? filepath ?? derived
      const dir = pathFormatter.format(raw)
      const patterns = (props.request.patterns ?? []).filter(
        (p): p is string => typeof p === "string",
      )

      return {
        icon: "<-",
        title: `Access external directory ${dir}`,
        body:
          patterns.length > 0 ? (
            <Box paddingLeft={1} gap={1} flexDirection="column">
              <Text dimColor>Patterns</Text>
              {patterns.map((p) => (
                <Text key={p} color={theme.text}>
                  - {p}
                </Text>
              ))}
            </Box>
          ) : null,
      }
    }

    if (permission === "doom_loop") {
      return {
        icon: "~",
        title: "Continue after repeated failures",
        body: (
          <Box paddingLeft={1}>
            <Text dimColor>This keeps the session running despite repeated failures.</Text>
          </Box>
        ),
      }
    }

    return {
      icon: "o",
      title: `Call tool ${permission}`,
      body: (
        <Box paddingLeft={1}>
          <Text dimColor>{"Tool: " + permission}</Text>
        </Box>
      ),
    }
  })()

  const header = (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1} flexShrink={0}>
        <Text color={theme.warning}>!</Text>
        <Text color={theme.text}>Permission required</Text>
      </Box>
      <Box flexDirection="row" gap={1} paddingLeft={2} flexShrink={0}>
        <Text dimColor>{info.icon}</Text>
        <Text color={theme.text}>{info.title}</Text>
      </Box>
    </Box>
  )

  return (
    <Prompt
      title="Permission required"
      header={header}
      body={info.body}
      options={{ once: "Allow once", always: "Allow always", reject: "Reject" }}
      escapeKey="reject"
      onSelect={(option) => {
        // If the SDK client lacks the permission surface, every option
        // below would be a silent no-op. Warn and close the prompt
        // instead of leaving a dialog that can never be resolved.
        // (Defensive only: createDefaultClient doesn't model `permission`
        // today, so this component is not mounted anywhere yet.)
        if (!sdk.client.permission?.reply) {
          console.warn(
            "[permission] SDK does not implement permission.reply; cannot resolve prompt",
          )
          props.onComplete?.()
          return
        }
        if (option === "always") {
          setStage("always")
          return
        }
        if (option === "reject") {
          if (session?.parentID) {
            setStage("reject")
            return
          }
          void sdk.client.permission.reply({
            reply: "reject",
            requestID: props.request.id,
            directory: props.directory,
            workspace: project.workspace.current(),
          })
          return
        }
        void sdk.client.permission.reply({
          reply: "once",
          requestID: props.request.id,
          directory: props.directory,
          workspace: project.workspace.current(),
        })
      }}
    />
  )
}
