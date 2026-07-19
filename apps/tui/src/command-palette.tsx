/**
 * Command palette dialog.
 *
 * Ported from OpenCode's `component/command-palette.tsx`. The original drove
 * a `DialogSelect` whose options came from a global keymap; we use
 * `ink-select-input` for the picker and read commands from a registry that
 * the parent TUI populates via `commandPalette.registry.set(...)`.
 *
 * For now the registry is a tiny module-local store: callers push command
 * descriptors and the dialog renders them. Wiring to OpenCode's keymap is
 * deferred until Maximilian ships its own command bus.
 */

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import { Box, Text } from "ink"
import SelectInput from "ink-select-input"
import { useLocale, t } from "@max/i18n"

export type CommandDescriptor = {
  name: string
  title: string
  description?: string
  category?: string
  hidden?: boolean
  suggested?: boolean
  onSelect: () => void
}

type Registry = {
  list: () => CommandDescriptor[]
  set: (commands: CommandDescriptor[]) => void
  append: (commands: CommandDescriptor[]) => void
}

// We keep the *handlers* on the module-level registry but bind them to
// component state via `useEffect` (NOT inline in the function body).
// The previous implementation mutated `registry.set = ...` directly
// during render — in Strict Mode or HMR re-mounts, the registry kept
// a stale setState reference and dispatched updates into a dead
// component, causing "state update on an unmounted component" warnings
// and dropped command registrations.
type RegistryState = {
  list: () => CommandDescriptor[]
  set: (commands: CommandDescriptor[]) => void
  append: (commands: CommandDescriptor[]) => void
}
let registryState: RegistryState = {
  list: () => [],
  set: () => {},
  append: () => {},
}
const registry: Registry = {
  list: () => registryState.list(),
  set: (commands) => registryState.set(commands),
  append: (commands) => registryState.append(commands),
}

export function setCommandPaletteCommands(commands: CommandDescriptor[]): void {
  registry.set(commands)
}

// `append` keeps previously-registered commands so multiple callers (e.g. the
// App root registering `/language` and a feature plugin registering its own
// commands) can layer onto the same palette without clobbering each other.
export function appendCommandPaletteCommands(commands: CommandDescriptor[]): void {
  registry.append(commands)
}

export type CommandPaletteRef = {
  open: () => void
  close: () => void
  filter?: string
}

export const CommandPaletteDialog = forwardRef<CommandPaletteRef | undefined, object>(function CommandPaletteDialog(_props, ref) {
  useLocale()
  const [open, setOpen] = useState(false)
  const [commands, setCommandsState] = useState<CommandDescriptor[]>([])
  const filterRef = useRef<string | undefined>(undefined)
  // Capture the current setState in a ref so the registry's `set` always
  // sees the LATEST reference, even across Strict-Mode double-invocation.
  const setCommandsRef = useRef(setCommandsState)
  setCommandsRef.current = setCommandsState
  // Same idea for `commands` so `registry.list()` returns fresh data.
  const commandsRef = useRef(commands)
  commandsRef.current = commands

  useEffect(() => {
    // Bind once on mount; unbind on unmount to a no-op so a stale caller
    // doesn't accidentally re-populate state on an unmounted component.
    const previous = registryState
    registryState = {
      list: () => commandsRef.current,
      set: (commands) => setCommandsRef.current(commands),
      append: (more) => setCommandsRef.current((prev) => [...prev, ...more]),
    }
    return () => {
      registryState = previous
    }
  }, [])

  const visibleCommands = useMemo(() => commands.filter((c) => !c.hidden), [commands])
  const options = useMemo(
    () =>
      visibleCommands.map((command) => ({
        label: command.title,
        value: command.name,
      })),
    [visibleCommands],
  )

  useImperativeHandle(ref, () => ({
    open: () => {
      filterRef.current = undefined
      setOpen(true)
    },
    close: () => setOpen(false),
    get filter() {
      return filterRef.current
    },
  }))

  if (!open) return null
  if (options.length === 0) {
    return (
      <Box flexDirection="column" paddingLeft={1} paddingRight={1}>
        <Text>{t("tui.noCommandsRegistered")}</Text>
      </Box>
    )
  }
  return (
    <Box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <Box marginBottom={1}>
        <Text bold>{t("tui.commands")}</Text>
      </Box>
      <SelectInput
        items={options}
        onSelect={(item) => {
          const cmd = visibleCommands.find((c) => c.name === item.value)
          setOpen(false)
          cmd?.onSelect()
        }}
      />
      <Box marginTop={1}>
        {visibleCommands.find((c) => c.suggested) ? (
          <Text dimColor>suggested commands are highlighted first</Text>
        ) : null}
      </Box>
    </Box>
  )
})