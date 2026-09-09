import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime"
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
let registryState = {
  list: () => [],
  set: () => {},
  append: () => {},
}
const registry = {
  list: () => registryState.list(),
  set: (commands) => registryState.set(commands),
  append: (commands) => registryState.append(commands),
}
export function setCommandPaletteCommands(commands) {
  registry.set(commands)
}
// `append` keeps previously-registered commands so multiple callers (e.g. the
// App root registering `/language` and a feature plugin registering its own
// commands) can layer onto the same palette without clobbering each other.
export function appendCommandPaletteCommands(commands) {
  registry.append(commands)
}
export const CommandPaletteDialog = forwardRef(function CommandPaletteDialog(_props, ref) {
  useLocale()
  const [open, setOpen] = useState(false)
  const [commands, setCommandsState] = useState([])
  const filterRef = useRef(undefined)
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
    return _jsx(Box, {
      flexDirection: "column",
      paddingLeft: 1,
      paddingRight: 1,
      children: _jsx(Text, { children: t("tui.noCommandsRegistered") }),
    })
  }
  return _jsxs(Box, {
    flexDirection: "column",
    paddingLeft: 1,
    paddingRight: 1,
    children: [
      _jsx(Box, {
        marginBottom: 1,
        children: _jsx(Text, { bold: true, children: t("tui.commands") }),
      }),
      _jsx(SelectInput, {
        items: options,
        onSelect: (item) => {
          const cmd = visibleCommands.find((c) => c.name === item.value)
          setOpen(false)
          cmd?.onSelect()
        },
      }),
      _jsx(Box, {
        marginTop: 1,
        children: visibleCommands.find((c) => c.suggested)
          ? _jsx(Text, { dimColor: true, children: "suggested commands are highlighted first" })
          : null,
      }),
    ],
  })
})
