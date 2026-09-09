/**
 * PermissionDialog — the prompt half of the permissions UI. Renders a modal
 * when a tool call needs human approval; clicking Allow / Deny hits the API
 * to unblock the parked task. The dialog is purely a view over the
 * `usePermissionPrompt` hook — it doesn't subscribe to SSE itself, so
 * multiple instances won't double-listen.
 */

import { useEffect, useState } from "react"
import { ShieldCheck, ShieldX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { PendingPermission } from "@/lib/permissions"
import { DiffPreview } from "./_helpers/DiffPreview"
import { useLocale, t } from "@max/i18n"

export interface PermissionDialogProps {
  pending: PendingPermission | null
  /**
   * Total number of queued prompts (including the currently displayed one).
   * When > 1, a "Next" button is shown so the user can skip a prompt they
   * don't want to think about right now without blocking the entire queue.
   */
  queueSize?: number
  /** Skip the current prompt without answering it. */
  onSkip?: () => void
  onAnswer: (decision: "allow" | "deny") => Promise<void>
  onApprovalAnswer?: (decision: "approve" | "reject", comment: string | undefined) => Promise<void>
}

export function PermissionDialog({
  pending,
  queueSize = 1,
  onSkip,
  onAnswer,
  onApprovalAnswer,
}: PermissionDialogProps) {
  useLocale()
  const open = pending !== null
  const isApproval = pending?.kind === "approval"
  const requireComment = pending?.kind === "approval" && pending.requireComment === true
  const [comment, setComment] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset transient state whenever the pending prompt changes. Without
  // this, a fresh approval after a previous one would inherit leftover
  // comment text and the prior submit/error state.
  useEffect(() => {
    setComment("")
    setSubmitting(false)
    setError(null)
  }, [pending?.requestId])

  const trimmedComment = comment.trim()
  const commentMissing = requireComment && trimmedComment.length === 0

  // Synchronous guard against double-clicks for the tool (non-approval) path.
  // The approval path already has a `submitting` state machine below, but
  // the tool permission buttons were unguarded: every click fired
  // `onAnswer(...)` again. With a flaky network the user could race Allow
  // then Deny, sending contradictory decisions to the backend.
  function answerTool(decision: "allow" | "deny") {
    if (submitting) return
    setSubmitting(true)
    void onAnswer(decision).finally(() => setSubmitting(false))
  }

  async function submit(decision: "approve" | "reject") {
    if (!pending || pending.kind !== "approval") return
    if (submitting) return
    if (commentMissing) {
      setError(t("approvals.commentRequired"))
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await onApprovalAnswer?.(decision, trimmedComment.length > 0 ? trimmedComment : undefined)
      setComment("")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  // ESC and backdrop click default to the safe choice: deny for tool
  // permissions (skip the call) and reject for approvals. The previous
  // `() => {}` handler silently swallowed every dismiss attempt, so a user
  // who hit ESC got a dialog that wouldn't go away — they'd have to click
  // one of the buttons even to reject. ESC now resolves the prompt so the
  // parked task unblocks instead of hanging in `executing`.
  function handleOpenChange(next: boolean) {
    if (next) return
    if (!pending) return
    if (pending.kind === "approval") {
      void submit("reject")
    } else {
      // submit() is approval-only; permissions call onAnswer directly.
      if (submitting) return
      setSubmitting(true)
      void onAnswer("deny").finally(() => setSubmitting(false))
    }
  }

  // Show a queue counter when more than one prompt is waiting, so the
  // user knows there are siblings they haven't seen yet.
  const hasQueue = queueSize > 1

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-testid="permission-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            {isApproval ? t("approvals.required.title") : t("permissions.required.title")}
            {hasQueue ? (
              <span
                className="ml-1 text-xs font-normal text-muted-foreground"
                data-testid="perm-dialog-queue"
              >
                {/* current is always 1 by construction: the dialog only ever
                    renders the FIFO head of the pending queue. */}
                {t("permissions.queueCounter", { current: 1, total: queueSize })}
              </span>
            ) : null}
          </DialogTitle>
          <DialogDescription>
            {isApproval
              ? t("approvals.required.description")
              : t("permissions.required.description")}
          </DialogDescription>
        </DialogHeader>

        {pending && (
          <div className="space-y-2 text-sm">
            {pending.kind === "approval" ? (
              <>
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-20">{t("approvals.prompt")}</span>
                  <code
                    className="font-mono bg-background/60 px-2 py-0.5 rounded break-all"
                    data-testid="perm-dialog-target"
                  >
                    {pending.prompt}
                  </code>
                </div>
                {pending.reason ? (
                  <div className="text-xs text-muted-foreground">
                    <span className="font-medium">{t("approvals.reason")}:</span> {pending.reason}
                  </div>
                ) : null}
                <div className="space-y-1 pt-1">
                  <Textarea
                    value={comment}
                    onChange={(e) => {
                      setComment(e.target.value)
                      if (error) setError(null)
                    }}
                    placeholder={t("approvals.commentPlaceholder")}
                    data-testid="perm-dialog-comment"
                    rows={3}
                    disabled={submitting}
                  />
                  {error ? (
                    <div className="text-xs text-destructive" data-testid="perm-dialog-error">
                      {error}
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-20">{t("permissions.tool")}</span>
                  <code
                    className="font-mono bg-background/60 px-2 py-0.5 rounded"
                    data-testid="perm-dialog-tool"
                  >
                    {pending.tool}
                  </code>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-20">{t("permissions.target")}</span>
                  <code
                    className="font-mono bg-background/60 px-2 py-0.5 rounded break-all"
                    data-testid="perm-dialog-target"
                  >
                    {pending.target || t("permissions.targetEmpty")}
                  </code>
                </div>
                {pending.tool === "edit" || pending.tool === "write" ? (
                  <DiffPreview tool={pending.tool} input={pending.input} />
                ) : null}
              </>
            )}
            <div className="text-xs text-muted-foreground">
              {t("permissions.workspace")} <code>{pending.workspaceId}</code> ·{" "}
              {t("permissions.task")} <code>{pending.taskId}</code>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {hasQueue && onSkip ? (
            <Button
              variant="ghost"
              onClick={onSkip}
              disabled={submitting}
              data-testid="perm-dialog-skip"
            >
              {t("permissions.skip")}
            </Button>
          ) : null}
          {isApproval ? (
            <>
              <Button
                variant="destructive"
                onClick={() => void submit("reject")}
                disabled={submitting || commentMissing}
                data-testid="perm-dialog-deny"
              >
                <ShieldX className="h-4 w-4 mr-1" />
                {t("approvals.reject")}
              </Button>
              <Button
                onClick={() => void submit("approve")}
                disabled={submitting || commentMissing}
                data-testid="perm-dialog-allow"
              >
                <ShieldCheck className="h-4 w-4 mr-1" />
                {t("approvals.approve")}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="destructive"
                onClick={() => answerTool("deny")}
                disabled={submitting}
                data-testid="perm-dialog-deny"
              >
                <ShieldX className="h-4 w-4 mr-1" />
                {t("permissions.deny")}
              </Button>
              <Button
                onClick={() => answerTool("allow")}
                disabled={submitting}
                data-testid="perm-dialog-allow"
              >
                <ShieldCheck className="h-4 w-4 mr-1" />
                {t("permissions.allow")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
