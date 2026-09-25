import { useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { PanelRightClose } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useMention, type MentionGroupId, type MentionSuggestion } from "@/hooks/useMention"
import { COMMANDS, type DashboardTab } from "@/lib/commands"
import type { RuntimeEvent } from "@/api"
import { EmptyState } from "./EmptyState"
import { ConversationTimeline } from "./ConversationTimeline"
import { withTextUnitEvents } from "./conversation/model"
import { QuickPick } from "./quickpick/QuickPick"
import { commandQuickPickItems, type QuickPickItem } from "./quickpick/model"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { useLocale, t } from "@max/i18n"
import { useComposerDraftStore } from "@/stores/composerDraftStore"
import type { Workspace } from "../api"

const PRESET_KEYS = ["preset.todo", "preset.scraper", "preset.blog"] as const

/**
 * Skills offered in the mention popup's "Skills" section — HONESTLY
 * EMPTY today: the chat composer receives no skill-discovery source
 * (the mentions model's skills provider wants a feature-flag getter
 * that is not wired into this panel), so the section renders its header
 * with an explicit empty explanation instead of invented entries.
 */
const MENTION_SKILLS: MentionSuggestion[] = []

/** Popup header + empty-note i18n keys per mention group. */
const MENTION_GROUP_LABEL: Record<MentionGroupId, string> = {
  roles: "mentions.roles.title",
  skills: "mentions.skills.title",
}

export function ChatPanel({
  onSubmit,
  onAbort,
  submitting,
  workspace,
  sidebar,
  sidebarHidden,
  onToggleSidebar,
  mentionSuggestions = [],
  onOpenProviders,
  onOpenPalette,
  onNavigate,
  events = [],
  live = false,
  showHeading = true,
}: {
  onSubmit: (message: string) => void
  /** Abort the in-flight submission + close the SSE stream. When omitted
   *  the panel falls back to a disabled Send button (legacy behavior). */
  onAbort?: () => void
  submitting: boolean
  workspace: Workspace | null
  /**
   * Optional sidebar content (the dock panel registry's workspace stack).
   * When provided AND visible it renders as a collapsible drawer inside
   * the panel: an absolutely-positioned 320px overlay above the right
   * edge of the conversation (z above the timeline and its popups). The
   * conversation column itself stays full-width underneath — the drawer
   * covers it instead of squeezing it, so the composer / timeline
   * geometry never depends on the drawer state.
   */
  sidebar?: React.ReactNode
  /** Hide the sidebar drawer even when `sidebar` is passed (workspace pref
   *  / keyboard toggle). The panel renders no drawer at all while set. */
  sidebarHidden?: boolean
  /**
   * Toggle callback for the drawer's close button — wired to the same
   * workspace-prefs write the App keyboard layer (Ctrl+Shift+B) performs,
   * so button and keybind flip one shared source of truth. Unset = the
   * close affordance is omitted (drawer is then toggled externally only).
   */
  onToggleSidebar?: () => void
  /** @mention suggestions (agent roles) for the prompt editor. */
  mentionSuggestions?: MentionSuggestion[]
  onOpenProviders?: () => void
  onOpenPalette?: () => void
  /** Navigate to a dashboard tab — the "/" slash menu's navigation
   *  commands call this directly on selection (no text is inserted into
   *  the composer). Unset = those commands list as disabled. */
  onNavigate?: (tab: DashboardTab) => void
  /** Live runtime events for the conversation timeline. */
  events?: RuntimeEvent[]
  /** true while a run is in flight (enables timeline auto-tail). */
  live?: boolean
  /**
   * Hide the inner heading when the panel is dock-hosted (the dock leaf
   * header already names the panel). Defaults to true for standalone use.
   */
  showHeading?: boolean
}) {
  const { locale } = useLocale()
  const chatSchema = z.object({
    message: z
      .string()
      .trim()
      .min(1, t("chat.messageRequired"))
      .max(8000, t("chat.messageTooLong")),
  })
  type ChatForm = z.infer<typeof chatSchema>
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isValid },
  } = useForm<ChatForm>({
    resolver: zodResolver(chatSchema),
    defaultValues: { message: "" },
    mode: "onChange",
  })

  const messageValue = watch("message")
  const messageRegister = register("message")
  const mention = useMention(mentionSuggestions, { skills: MENTION_SKILLS })

  // ── "/" slash menu (QuickPick over the command registry) ──────────────
  // Typing a lone "/" at the composer's start opens the picker; a
  // navigation command calls onNavigate directly, custom actions fire
  // their panel-reachable executor, and NOTHING is ever inserted into
  // the composer text (the lone trigger slash is dropped on selection).
  const [slashOpen, setSlashOpen] = useState(false)
  const slashItems = useMemo(
    () =>
      commandQuickPickItems(COMMANDS, t, {
        openPalette: onOpenPalette !== undefined,
        stopStream: onAbort !== undefined,
      }),
    [onOpenPalette, onAbort, locale],
  )

  const handleSlashSelect = (item: QuickPickItem) => {
    const command = COMMANDS.find((c) => c.id === item.id)
    if (!command || item.disabled) return
    if (command.navigateTo !== undefined) onNavigate?.(command.navigateTo)
    else if (command.action === "open-palette") onOpenPalette?.()
    else if (command.action === "stop-stream") onAbort?.()
    // The "/" was a trigger, not content — drop it so the composer is
    // clean for the next message. Never insert anything on selection.
    if (messageValue === "/") {
      reset({ message: "" })
      if (workspaceId) clearDraft(workspaceId)
    }
  }

  // Per-workspace unsent draft (composerDraftStore, persisted): every
  // keystroke saves it under the workspace id, submitting clears it, and
  // switching workspaces restores the draft that belongs to the newly
  // active one. Without a workspace (first submit) nothing persists.
  const workspaceId = workspace?.id
  const setDraft = useComposerDraftStore((s) => s.setDraft)
  const clearDraft = useComposerDraftStore((s) => s.clearDraft)
  useEffect(() => {
    if (!workspaceId) return
    const saved = useComposerDraftStore.getState().drafts[workspaceId]
    reset({ message: saved ?? "" })
  }, [workspaceId, reset])

  function submit(text?: string) {
    if (text) {
      // Preset button path. Validate against the same Zod schema as the
      // textarea so a missing/empty translation can't sneak an empty
      // string into chatApi.chat() and trip the backend. The previous
      // implementation bypassed validation entirely here, so a localised
      // preset with an unset i18n key would silently fire an empty
      // request and the workspace would get stuck in `planning`.
      const parsed = chatSchema.safeParse({ message: text })
      if (!parsed.success) return
      onSubmit(parsed.data.message.trim())
    } else {
      handleSubmit((data) => {
        onSubmit(data.message.trim())
        // Explicit empty reset — a bare reset() would restore the values the
        // draft-restore effect last applied, not a clean slate.
        reset({ message: "" })
        // The draft was just sent — drop it from the store + storage.
        if (workspaceId) clearDraft(workspaceId)
      })()
    }
  }

  // Dock panel registry content + not toggled off (workspace pref, shared
  // with the App keyboard layer) → the drawer mounts over the conversation.
  const showSidebar = !!sidebar && !sidebarHidden

  // The pipeline input for the timeline: the extracted steering/system
  // text segments (textUnits) spliced back into the stream as tagged
  // synthetic text events, so they compile into the SAME turns they
  // were steered to and surface with TextUnitBlock styling. Same
  // reference when there is nothing to extract (no re-render churn).
  const surfaceEvents = useMemo(() => withTextUnitEvents(events, workspace), [events, workspace])

  // Popup sections with their flat-list start offset, so the grouped
  // render maps the hook's flat highlight index correctly.
  let groupOffset = 0
  const popupGroups = mention.groups.map((group) => {
    const start = groupOffset
    groupOffset += group.items.length
    return { ...group, start }
  })

  return (
    // `relative` anchors the sidebar drawer; the grid stays single-column
    // in every state — the drawer overlays the conversation instead of
    // resizing it, so the timeline/composer geometry is drawer-invariant.
    <div
      className="relative h-full p-4"
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr)",
        gridTemplateRows: "1fr",
      }}
    >
      {/* Main conversation column — `min-h-0` keeps the timeline's
          scroll region the single overflow owner of the row. */}
      <div className="flex h-full min-h-0 min-w-0 flex-col">
        {!workspace && (
          <div className="mb-2">
            <EmptyState onOpenProviders={onOpenProviders} onOpenPalette={onOpenPalette} />
          </div>
        )}

        {/* 会话顶格渲染: the conversation column spends no heading row.
            When the panel owns a title (standalone use) it rides IN the
            timeline's toolbar row via the `toolbarLead` slot — natively
            flex-aligned with the find/navigator buttons, so there is no
            overlay or reserved margin to keep in sync. Dock-hosted
            panels pass showHeading={false} and render the identical
            geometry minus the badge: same paddings, same scroll region,
            same column baseline in both modes. */}
        <div className="flex min-h-0 flex-1 flex-col" data-testid="chat-timeline-shell">
          <ConversationTimeline
            events={surfaceEvents}
            workspace={workspace}
            live={live}
            toolbarLead={
              showHeading ? (
                <Badge
                  variant="secondary"
                  className="h-5 max-w-[72px] truncate px-1.5 text-[10px] font-normal text-muted-foreground"
                  title={t("chat.title")}
                  data-testid="chat-title-badge"
                >
                  {t("chat.title")}
                </Badge>
              ) : undefined
            }
          />
        </div>

        <div className="pt-2 border-t border-border">
          <div className="relative">
            <Textarea
              {...messageRegister}
              rows={3}
              placeholder={t("chat.inputPlaceholder")}
              onChange={(e) => {
                messageRegister.onChange(e)
                mention.onChange(e.target.value, e.target.selectionStart ?? e.target.value.length)
                // A lone "/" at the composer's start is the slash-menu
                // trigger — open the QuickPick, mutate nothing.
                setSlashOpen(e.target.value === "/")
                // Save the unsent draft for this workspace (persisted).
                if (workspaceId) setDraft(workspaceId, e.target.value)
              }}
              onKeyDown={(e) => {
                if (mention.onKeyDown(e)) return
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit()
              }}
              className="resize-none bg-muted/50"
            />
            {/* "/" slash menu — the command registry as a QuickPick.
                Navigation goes through onNavigate; selection never
                inserts text into the composer. */}
            {slashOpen && (
              <div className="absolute bottom-full left-0 z-20 mb-1" data-testid="slash-quickpick">
                <QuickPick
                  open={slashOpen}
                  onOpenChange={setSlashOpen}
                  items={slashItems}
                  onSelect={handleSlashSelect}
                  placeholder={t("quickpick.slash.placeholder")}
                />
              </div>
            )}
            {mention.suggestions.length > 0 && (
              <ul
                className="absolute bottom-full left-0 mb-1 z-10 w-64 rounded-md border border-border bg-popover p-1 shadow-md"
                data-testid="mention-popup"
              >
                {popupGroups.map((group) => (
                  <li
                    key={group.id}
                    className="list-none"
                    data-testid={`mention-group-${group.id}`}
                  >
                    <ul className="list-none p-0">
                      <li
                        className="mt-1 px-2 pb-0.5 pt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                        data-testid={`mention-group-header-${group.id}`}
                      >
                        {t(MENTION_GROUP_LABEL[group.id])}
                      </li>
                      {group.id === "skills" && group.items.length === 0 && (
                        <li
                          className="px-2 py-1 text-[11px] text-muted-foreground"
                          data-testid="mention-skills-empty"
                        >
                          {t("mentions.skills.empty")}
                        </li>
                      )}
                      {group.items.map((s, i) => (
                        <li
                          key={s.token}
                          className={`flex items-baseline gap-2 rounded px-2 py-1 text-xs ${
                            group.start + i === mention.highlighted ? "bg-accent" : ""
                          }`}
                        >
                          <span className="font-mono font-medium">@{s.token}</span>
                          {s.description && (
                            <span className="truncate text-muted-foreground">{s.description}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {errors.message && (
            <p className="text-sm text-destructive mt-1">{errors.message.message}</p>
          )}
          <div className="flex items-center justify-between mt-2">
            <div className="flex gap-1.5 flex-wrap">
              {PRESET_KEYS.map((key) => {
                const label = t(key)
                return (
                  <Button
                    key={key}
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => submit(label)}
                    title={label}
                  >
                    {label.length > 30 ? label.slice(0, 30) + "..." : label}
                  </Button>
                )
              })}
            </div>
            {submitting && onAbort ? (
              // Stop button — aborts the in-flight POST + closes the
              // SSE stream so the user can recover from a wrong input.
              // IMPORTANT: this stops the UI only. The server-side
              // workspace execution continues until a cancel endpoint
              // is wired through; the orphaned workspace keeps running
              // and emits events to no subscriber.
              <Button onClick={onAbort} variant="destructive" title={t("chat.stopServerHint")}>
                {t("common.stop")}
              </Button>
            ) : (
              <Button
                onClick={() => submit()}
                disabled={submitting || !isValid || !messageValue?.trim()}
              >
                {submitting ? t("common.sending") : t("common.send")}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Workspace sidebar DRAWER (dock-panel-registry content). Opens as
          an absolute 320px overlay above the conversation's right edge —
          same visual chrome as the old trailing column (rounded border,
          card background, p-3 stack) but nothing reflows underneath. The
          close button routes through onToggleSidebar: the SAME prefs write
          the App keyboard layer's Ctrl+Shift+B performs, so button and
          keybind stay one source of truth. inset-y-4/right-4 mirror the
          panel's own p-4 so the drawer aligns with the content box. */}
      {showSidebar && (
        <aside
          data-testid="workspace-sidebar-aside"
          aria-label={t("layout.drawer.title")}
          className="absolute inset-y-4 right-4 z-30 flex w-80 min-h-0 flex-col overflow-hidden rounded-md border border-border bg-card shadow-lg"
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
            <span className="truncate text-xs font-medium text-muted-foreground">
              {t("layout.drawer.title")}
            </span>
            {onToggleSidebar && (
              <button
                type="button"
                data-testid="workspace-sidebar-close"
                aria-label={t("layout.drawer.close")}
                title={t("layout.drawer.close")}
                className="flex items-center rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                onClick={onToggleSidebar}
              >
                <PanelRightClose className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {/* Scroll region: the stacked panels own the overflow exactly as
              in the old trailing column; h-full chain keeps the dock
              content filling the drawer body. */}
          <div className="min-h-0 flex-1 overflow-y-auto p-3">{sidebar}</div>
        </aside>
      )}
    </div>
  )
}
