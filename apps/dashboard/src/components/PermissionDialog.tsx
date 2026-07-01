/**
 * PermissionDialog — the prompt half of the permissions UI. Renders a modal
 * when a tool call needs human approval; clicking Allow / Deny hits the API
 * to unblock the parked task. The dialog is purely a view over the
 * `usePermissionPrompt` hook — it doesn't subscribe to SSE itself, so
 * multiple instances won't double-listen.
 */

import { ShieldCheck, ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PendingPermission } from "@/lib/permissions";
import { useLocale, t } from "@max/i18n";

export interface PermissionDialogProps {
  pending: PendingPermission | null;
  onAnswer: (decision: "allow" | "deny") => Promise<void>;
  onApprovalAnswer?: (decision: "approve" | "reject") => Promise<void>;
}

export function PermissionDialog({ pending, onAnswer, onApprovalAnswer }: PermissionDialogProps) {
  useLocale();
  const open = pending !== null;
  return (
    <Dialog open={open} onOpenChange={() => { /* read-only: only buttons dismiss */ }}>
      <DialogContent data-testid="permission-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            {t("permissions.required.title")}
          </DialogTitle>
          <DialogDescription>
            {t("permissions.required.description")}
          </DialogDescription>
        </DialogHeader>

        {pending && (
          <div className="space-y-2 text-sm">
            {pending.kind === "approval" ? (
              <>
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-20">Approval</span>
                  <code className="font-mono bg-background/60 px-2 py-0.5 rounded break-all" data-testid="perm-dialog-target">
                    {pending.prompt}
                  </code>
                </div>
                {pending.reason ? (
                  <div className="text-xs text-muted-foreground">{pending.reason}</div>
                ) : null}
              </>
            ) : (
              <>
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-20">{t("permissions.tool")}</span>
                  <code className="font-mono bg-background/60 px-2 py-0.5 rounded" data-testid="perm-dialog-tool">
                    {pending.tool}
                  </code>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-20">{t("permissions.target")}</span>
                  <code className="font-mono bg-background/60 px-2 py-0.5 rounded break-all" data-testid="perm-dialog-target">
                    {pending.target || t("permissions.targetEmpty")}
                  </code>
                </div>
              </>
            )}
            <div className="text-xs text-muted-foreground">
              {t("permissions.workspace")} <code>{pending.workspaceId}</code> · {t("permissions.task")} <code>{pending.taskId}</code>
            </div>
          </div>
        )}


        <DialogFooter className="gap-2">
          <Button
            variant="destructive"
            onClick={() => pending && (pending.kind === "approval" ? onApprovalAnswer?.("reject") : onAnswer("deny"))}
            data-testid="perm-dialog-deny"
          >
            <ShieldX className="h-4 w-4 mr-1" />
            {pending?.kind === "approval" ? "Reject" : t("permissions.deny")}
          </Button>
          <Button
            onClick={() => pending && (pending.kind === "approval" ? onApprovalAnswer?.("approve") : onAnswer("allow"))}
            data-testid="perm-dialog-allow"
          >
            <ShieldCheck className="h-4 w-4 mr-1" />
            {pending?.kind === "approval" ? "Approve" : t("permissions.allow")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
