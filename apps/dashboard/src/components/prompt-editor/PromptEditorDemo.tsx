// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * PromptEditorDemo — Storybook-style composition preview: PromptToolbar
 * + MentionTextarea + the inline slash popup + the slash QuickPick, all
 * wired over local state with no store or API dependencies. The main
 * session later lifts this composition into ChatPanel; until then this
 * export is the preview + smoke-test surface for the prompt-editor域.
 */

import { useMemo, useRef, useState } from "react"
import { useLocale, t } from "@max/i18n"
import type { CommandDef } from "@/lib/commands"
import { Button } from "@/components/ui/button"
import { QuickPick } from "@/components/quickpick/QuickPick"
import type { QuickPickItem } from "@/components/quickpick/model"
import {
  createRolesProvider,
  createSkillsProvider,
  createWorkspacesProvider,
  type MentionProvider,
  type WorkspaceRef,
} from "@/components/mentions/model"
import { MentionTextarea } from "@/components/mentions/MentionTextarea"
import { addAttachments, filesToAttachments, parseSlashQuery, type Attachment } from "./model"
import { useSlashCommands, slashKindLabel } from "./useSlashCommands"
import { PromptToolbar } from "./PromptToolbar"

export interface PromptEditorDemoProps {
  /** Workspaces injected into the "#" provider (props, not API). */
  workspaces?: WorkspaceRef[]
  /** Feature-flag skill names for the "@" skills provider. */
  skills?: string[]
  /** Executed navigation commands hand their tab back to the host. */
  onNavigate?: (tab: CommandDef["navigateTo"]) => void
  className?: string
}

export function PromptEditorDemo({
  workspaces = [
    { id: "ws-main", name: "Maximilian Main", path: "~/Maximilian/Maximilian" },
    { id: "ws-docs", name: "Docs Site", path: "~/Maximilian/docs" },
  ],
  skills,
  onNavigate,
  className,
}: PromptEditorDemoProps) {
  useLocale()
  const [text, setText] = useState("")
  const [caret, setCaret] = useState(0)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [rejectedCount, setRejectedCount] = useState(0)
  const [sent, setSent] = useState<string | null>(null)
  const [slashPickOpen, setSlashPickOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const providers = useMemo<MentionProvider[]>(() => {
    const list: MentionProvider[] = [createRolesProvider(t)]
    if (skills && skills.length > 0) {
      list.push(createSkillsProvider(t, () => skills))
    }
    list.push(createWorkspacesProvider(t, workspaces))
    return list
  }, [skills, workspaces])

  const slash = useSlashCommands({
    text,
    caret,
    onSelect: (command) => runCommand(command),
  })

  const runCommand = (command: CommandDef) => {
    if (command.navigateTo && onNavigate) onNavigate(command.navigateTo)
    setSent(`/${command.id}`)
    // Consume the slash token from the input.
    setText((prev) => prev.replace(/^\/\S*/, ""))
    setCaret(0)
  }

  const runCommandRef = useRef(runCommand)
  runCommandRef.current = runCommand

  // Slash QuickPick items mirror the inline popup's model.
  const slashPickItems = useMemo<QuickPickItem[]>(
    () =>
      slash.items.map((v) => ({
        id: v.id,
        label: v.title,
        description: slashKindLabel(v.kind),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slashPickOpen],
  )

  const insertMention = () => {
    const el = textareaRef.current
    el?.focus()
    const at = caret
    const nextText = `${text.slice(0, at)}@${text.slice(at)}`
    setText(nextText)
    const nextCaret = at + 1
    setCaret(nextCaret)
    const restore = () => {
      if (el) el.selectionStart = el.selectionEnd = nextCaret
    }
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(restore)
    else restore()
  }

  const handleAttach = (files: unknown) => {
    const incoming = filesToAttachments(files)
    const result = addAttachments(attachments, incoming)
    setAttachments(result.attachments)
    setRejectedCount(result.rejected)
  }

  const send = () => {
    if (!text.trim()) return
    setSent(text)
    setText("")
    setCaret(0)
  }

  return (
    <section
      className={className}
      aria-label={t("promptEditor.demo.title")}
      data-testid="prompt-editor-demo"
    >
      <header className="mb-2">
        <h3 className="text-sm font-semibold">{t("promptEditor.demo.title")}</h3>
        <p className="text-muted-foreground text-xs">{t("promptEditor.demo.description")}</p>
      </header>

      <PromptToolbar
        attachments={attachments}
        onAttachFiles={handleAttach}
        onRemoveAttachment={(id) => setAttachments((prev) => prev.filter((a) => a.id !== id))}
        onOpenSlash={() => setSlashPickOpen(true)}
        onInsertMention={insertMention}
        rejectedCount={rejectedCount}
      />

      <div className="relative mt-1.5">
        <MentionTextarea
          value={text}
          onChange={setText}
          providers={providers}
          textareaRef={textareaRef}
          placeholder={t("promptEditor.demo.placeholder")}
          ariaLabel={t("promptEditor.demo.title")}
          onSubmit={send}
        />
        {slash.open && (
          <ul
            role="listbox"
            aria-label={t("promptEditor.slash.open")}
            className="bg-popover text-popover-foreground absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border shadow-md"
            data-testid="slash-popup"
          >
            {slash.items.map((v, i) => (
              <li key={v.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === slash.highlighted}
                  data-testid="slash-option"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    slash.select(v.command)
                  }}
                  className={
                    i === slash.highlighted
                      ? "bg-accent text-accent-foreground flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm"
                      : "flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm"
                  }
                >
                  <span className="font-medium">{v.title}</span>
                  <span className="text-muted-foreground text-[11px]">
                    {slashKindLabel(v.kind)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {slash.query !== null && slash.dismissed && (
          <p className="sr-only" role="status">
            {t("promptEditor.slash.empty")}
          </p>
        )}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <Button type="button" size="sm" data-testid="demo-send" onClick={send}>
          {t("promptEditor.demo.send")}
        </Button>
        {sent !== null && (
          <span className="text-muted-foreground text-xs" role="status" data-testid="demo-sent">
            {t("promptEditor.demo.sent", { text: sent })}
          </span>
        )}
      </div>

      {slashPickOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24">
          <button
            type="button"
            aria-label={t("promptEditor.slash.open")}
            className="absolute inset-0 cursor-default"
            onClick={() => setSlashPickOpen(false)}
          />
          <div className="relative">
            <QuickPick
              open={slashPickOpen}
              onOpenChange={setSlashPickOpen}
              items={slashPickItems}
              onSelect={(item) => {
                const command = slash.items.find((v) => v.id === item.id)?.command
                if (command) runCommandRef.current(command)
              }}
            />
          </div>
        </div>
      )}
    </section>
  )
}

// Re-exported for convenience so demo consumers get the same parse the
// inline popup uses (also handy in tests).
export { parseSlashQuery }
