// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * ShortcutsSection — the settings-style keyboard shortcut catalog
 * (ZCode ShortcutSettingsSection borrowing). Lists every command from
 * lib/commands with its effective keybind (override or default), the
 * click-to-record flow, per-command reset, and localStorage persistence
 * of overrides under "maximilian.shortcut-overrides". Conflict detection
 * warns when a recording duplicates another command's binding.
 */

import { useMemo, useState } from "react"
import { useLocale, t } from "@max/i18n"
import { RotateCcw } from "lucide-react"
import { COMMANDS, type CommandDef } from "@/lib/commands"
import {
  formatKeybind,
  keybindEquals,
  readOverrides,
  writeOverrides,
  type KeyPlatform,
  type ShortcutOverrides,
  type StorageLike,
} from "@/lib/keybinds"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useShortcutRecorder } from "./useShortcutRecorder"

export interface ShortcutsSectionProps {
  platform?: KeyPlatform
  /** Defaults to window.localStorage; injectable for tests. */
  storage?: StorageLike | null
  className?: string
}

interface RowNotice {
  id: string
  kind: "captured" | "cancelled" | "conflict"
  key?: string
  /** i18n key of the command the recording collides with. */
  conflictTitleKey?: string
}

const SECTIONS: CommandDef["section"][] = ["navigation", "actions", "view"]

export function ShortcutsSection({
  platform = "other",
  storage,
  className,
}: ShortcutsSectionProps) {
  useLocale()
  const store = storage ?? (typeof window !== "undefined" ? window.localStorage : null)
  const [overrides, setOverrides] = useState<ShortcutOverrides>(() => readOverrides(store))
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<RowNotice | null>(null)

  // The recorder callbacks close over a stale `recordingId`/`overrides`
  // once the window listener arms — mirror both in refs.
  const recordingIdRef = useMemo(() => ({ current: recordingId as string | null }), [])
  recordingIdRef.current = recordingId
  const overridesRef = useMemo(() => ({ current: overrides as ShortcutOverrides }), [])
  overridesRef.current = overrides

  const recorder = useShortcutRecorder({
    onCapture: (keybind) => {
      const id = recordingIdRef.current
      if (!id) return
      const next: ShortcutOverrides = { ...overridesRef.current, [id]: keybind }
      setOverrides(next)
      writeOverrides(store, next)
      const conflict = conflictFor(id, keybind, next)
      setNotice({
        id,
        kind: conflict ? "conflict" : "captured",
        key: formatKeybind(keybind, platform),
        conflictTitleKey: conflict?.titleKey,
      })
    },
    onCancel: () => {
      const id = recordingIdRef.current
      if (id) setNotice({ id, kind: "cancelled" })
    },
  })

  const effective = (command: CommandDef) => overrides[command.id] ?? command.keybind

  const startRecording = (command: CommandDef) => {
    if (command.enabled === false) return
    setNotice(null)
    setRecordingId(command.id)
    recorder.start()
  }

  const reset = (id: string) => {
    const next = { ...overrides }
    delete next[id]
    setOverrides(next)
    writeOverrides(store, next)
    setNotice(null)
  }

  const resetAll = () => {
    setOverrides({})
    writeOverrides(store, {})
    setNotice(null)
  }

  return (
    <section
      className={cn("space-y-4", className)}
      aria-label={t("shortcuts.title")}
      data-testid="shortcuts-section"
    >
      <header>
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          {t("shortcuts.title")}
        </h3>
        <p className="text-muted-foreground mt-0.5 text-xs">{t("shortcuts.description")}</p>
      </header>

      {SECTIONS.map((section) => {
        const commands = COMMANDS.filter((c) => c.section === section)
        if (commands.length === 0) return null
        return (
          <div key={section}>
            <h4 className="text-muted-foreground mb-1 text-[11px] font-medium uppercase tracking-wide">
              {t(`shortcuts.section.${section}`)}
            </h4>
            <ul className="divide-border divide-y" data-testid={`shortcuts-list-${section}`}>
              {commands.map((command) => {
                const keybind = effective(command)
                const recording = recordingId === command.id && recorder.recording
                return (
                  <li
                    key={command.id}
                    className="flex items-center justify-between gap-3 py-1.5"
                    data-testid="shortcuts-row"
                    data-command-id={command.id}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{t(command.titleKey)}</span>
                      {notice?.id === command.id && (
                        <span
                          className={cn(
                            "text-muted-foreground block text-[11px]",
                            notice.kind === "conflict" && "text-amber-600",
                          )}
                          role={notice.kind === "conflict" ? "alert" : "status"}
                          data-testid="shortcuts-row-notice"
                        >
                          {notice.kind === "captured" &&
                            t("shortcuts.record.captured", { key: notice.key ?? "" })}
                          {notice.kind === "cancelled" && t("shortcuts.record.cancelled")}
                          {notice.kind === "conflict" &&
                            t("shortcuts.conflict", {
                              command: t(notice.conflictTitleKey ?? notice.key ?? ""),
                            })}
                        </span>
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        disabled={command.enabled === false}
                        onClick={() => startRecording(command)}
                        data-testid="shortcuts-record"
                        aria-label={`${t("shortcuts.record.start")}: ${t(command.titleKey)}`}
                        className={cn(
                          "border-input bg-muted/40 rounded border px-2 py-0.5 font-mono text-xs",
                          recording && "border-ring animate-pulse ring-1",
                          "hover:border-ring disabled:cursor-not-allowed disabled:opacity-50",
                        )}
                      >
                        {recording
                          ? t("shortcuts.record.recording")
                          : keybind
                            ? formatKeybind(keybind, platform)
                            : t("shortcuts.record.start")}
                      </button>
                      {overrides[command.id] !== undefined && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`${t("shortcuts.reset")}: ${t(command.titleKey)}`}
                          title={t("shortcuts.reset")}
                          data-testid="shortcuts-reset"
                          onClick={() => reset(command.id)}
                        >
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      )}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}

      {Object.keys(overrides).length > 0 && (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="shortcuts-reset-all"
            onClick={resetAll}
          >
            {t("shortcuts.resetAll")}
          </Button>
          <span className="text-muted-foreground text-[11px]" role="status">
            {t("shortcuts.saved")}
          </span>
        </div>
      )}
    </section>
  )
}

/** Another command whose EFFECTIVE binding equals the recorded one. */
function conflictFor(
  id: string,
  keybind: NonNullable<CommandDef["keybind"]>,
  overrides: ShortcutOverrides,
): CommandDef | null {
  return (
    COMMANDS.find((other) => {
      if (other.id === id) return false
      const otherBinding = overrides[other.id] ?? other.keybind
      return otherBinding !== undefined && keybindEquals(otherBinding, keybind)
    }) ?? null
  )
}
