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
import { useLocale, t } from "@max/i18n"

export interface PermissionDialogProps {
  pending: PendingPermission | null
  onAnswer: (decision: "allow" | "deny") => Promise<void>
  onApprovalAnswer?: (decision: "approve" | "reject", comment: string | undefined) => Promise<void>
}

export function PermissionDialog({ pending, onAnswer, onApprovalAnswer }: PermissionDialogProps) {
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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-testid="permission-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            {isApproval ? t("approvals.required.title") : t("permissions.required.title")}
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
              </>
            )}
            <div className="text-xs text-muted-foreground">
              {t("permissions.workspace")} <code>{pending.workspaceId}</code> ·{" "}
              {t("permissions.task")} <code>{pending.taskId}</code>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
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
                onClick={() => void onAnswer("deny")}
                data-testid="perm-dialog-deny"
              >
                <ShieldX className="h-4 w-4 mr-1" />
                {t("permissions.deny")}
              </Button>
              <Button onClick={() => void onAnswer("allow")} data-testid="perm-dialog-allow">
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
