import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { usePendingProposals, useResolveProposal } from "@/lib/api/hooks";
import type { PendingProposal } from "../api";
import { useLocale, t } from "@max/i18n";

export function GovernancePortal() {
  useLocale();
  const { data, isLoading, error } = usePendingProposals();
  const resolveMutation = useResolveProposal();
  const [actionState, setActionState] = useState<{
    id: string;
    action: "approve" | "reject";
  } | null>(null);

  const proposals = data?.proposals ?? [];

  // Rebuild the schema inside the component so messages reflect the active
  // locale (Zod evaluates min/max messages eagerly at schema creation).
  const proposalActionSchema = z.object({
    user: z.string().min(1, t("governance.proposals.nameRequired")),
    reason: z.string().min(1, t("governance.proposals.reasonRequired")).max(2000, t("governance.proposals.reasonTooLong")),
  });
  type ProposalActionForm = z.infer<typeof proposalActionSchema>;

  const { register, handleSubmit, reset, formState: { errors } } = useForm<ProposalActionForm>({
    resolver: zodResolver(proposalActionSchema),
    defaultValues: { user: "admin", reason: "" },
  });

  useEffect(() => {
    if (actionState) {
      reset({ user: "admin", reason: "" });
    }
  }, [actionState, reset]);

  const handleAction = handleSubmit(async (formData) => {
    if (!actionState) return;
    try {
      await resolveMutation.mutateAsync({
        id: actionState.id,
        action: actionState.action,
        reason: formData.reason,
        user: formData.user,
      });
      setActionState(null);
    } catch {
      // Error handled by mutation state
    }
  });

  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-xs font-medium text-muted-foreground mb-4 uppercase tracking-wider">
        {t("governance.title")} ({proposals.length})
      </h2>

      {isLoading ? (
        <div className="text-center py-16 text-muted-foreground text-sm">{t("governance.proposals.loading")}</div>
      ) : error ? (
        <div className="text-center py-16 text-sm text-destructive">{t("governance.proposals.failedToLoad")}</div>
      ) : proposals.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          <p className="text-base font-medium mb-1 text-foreground">{t("governance.proposals.empty.title")}</p>
          <p>{t("governance.proposals.empty.hint")}</p>
        </div>
      ) : null}

      <div className="flex flex-col gap-4">
        {proposals.map((p) => (
          <ProposalCard
            key={p.proposalId}
            proposal={p}
            onAction={(action) => setActionState({ id: p.proposalId, action })}
          />
        ))}
      </div>

      <Dialog open={!!actionState} onOpenChange={(open) => { if (!open) setActionState(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionState?.action === "approve" ? t("governance.proposals.approveAction") : t("governance.proposals.rejectAction")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label htmlFor="gov-user" className="block text-sm text-muted-foreground mb-1">{t("governance.proposals.yourName")}</label>
              <Input id="gov-user" {...register("user")} placeholder="admin" />
              {errors.user && <p className="text-sm text-destructive mt-1">{errors.user.message}</p>}
            </div>
            <div>
              <label htmlFor="gov-reason" className="block text-sm text-muted-foreground mb-1">{t("governance.proposals.reason")}</label>
              <Textarea
                id="gov-reason"
                {...register("reason")}
                rows={3}
                placeholder={t("governance.proposals.reasonPlaceholder")}
              />
              {errors.reason && <p className="text-sm text-destructive mt-1">{errors.reason.message}</p>}
            </div>
            {resolveMutation.isError && (
              <p className="text-sm text-destructive">
                {resolveMutation.error instanceof Error ? resolveMutation.error.message : t("governance.proposals.actionFailed")}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setActionState(null)}>{t("common.cancel")}</Button>
            <Button
              variant={actionState?.action === "approve" ? "default" : "destructive"}
              onClick={handleAction}
              disabled={resolveMutation.isPending}
            >
              {resolveMutation.isPending ? t("common.processing") : actionState?.action === "approve" ? t("governance.proposals.approve") : t("governance.proposals.reject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProposalCard({
  proposal: p,
  onAction,
}: {
  proposal: PendingProposal;
  onAction: (action: "approve" | "reject") => void;
}) {
  const { proposal, simulation, score } = p;

  return (
    <Card className="bg-muted/30 border-border/50">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Badge className={ACTION_COLORS[proposal.action] ?? "bg-gray-800 text-gray-300"}>
              {proposal.action}
            </Badge>
            <span className="font-medium text-foreground">{proposal.subject}</span>
          </div>
          <span className="text-xs font-mono text-muted-foreground">{proposal.id.slice(0, 12)}</span>
        </div>

        <p className="text-sm text-muted-foreground mb-4">{proposal.rationale}</p>

        <div className="grid grid-cols-5 gap-3 mb-4">
          <MetricCell label={t("governance.metrics.quality")} value={score.qualityGain} positive />
          <MetricCell label={t("governance.metrics.latency")} value={score.latencyPenalty} />
          <MetricCell label={t("governance.metrics.cost")} value={score.costPenalty} />
          <MetricCell label={t("governance.metrics.risk")} value={score.riskPenalty} />
          <MetricCell label={t("governance.metrics.utility")} value={score.utility} positive />
        </div>

        <div className="flex gap-4 text-xs text-muted-foreground mb-4">
          <span>{t("governance.sim.cost")}: {simulation.costDelta >= 0 ? "+" : ""}{simulation.costDelta.toFixed(2)}</span>
          <span>{t("governance.sim.latency")}: {simulation.latencyDeltaMs >= 0 ? "+" : ""}{simulation.latencyDeltaMs.toFixed(0)}ms</span>
          <span>{t("governance.sim.quality")}: {simulation.qualityDelta >= 0 ? "+" : ""}{simulation.qualityDelta.toFixed(2)}</span>
          <span>{t("governance.sim.risk")}: {simulation.riskDelta >= 0 ? "+" : ""}{simulation.riskDelta.toFixed(2)}</span>
        </div>

        <div className="flex gap-3">
          <Button
            onClick={() => onAction("approve")}
            className="flex-1 bg-green-600 hover:bg-green-700 text-white"
          >
            {t("governance.proposals.approveMutation")}
          </Button>
          <Button
            variant="destructive"
            onClick={() => onAction("reject")}
            className="flex-1"
          >
            {t("governance.proposals.denyMutation")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

const ACTION_COLORS: Record<string, string> = {
  birth: "bg-green-900/50 text-green-300 border-green-700",
  retire: "bg-red-900/50 text-red-300 border-red-700",
  promote: "bg-blue-900/50 text-blue-300 border-blue-700",
  demote: "bg-yellow-900/50 text-yellow-300 border-yellow-700",
  merge: "bg-purple-900/50 text-purple-300 border-purple-700",
  split: "bg-amber-900/50 text-amber-300 border-amber-700",
  rebalance_team: "bg-emerald-900/50 text-emerald-300 border-emerald-700",
};

function MetricCell({
  label,
  value,
  positive,
}: {
  label: string;
  value: number;
  positive?: boolean;
}) {
  const colorClass = positive
    ? value > 0
      ? "text-green-400"
      : value < 0
        ? "text-red-400"
        : "text-muted-foreground"
    : value > 0.3
      ? "text-red-400"
      : value < 0
        ? "text-green-400"
        : "text-foreground";

  return (
    <div className="text-center">
      <div className={`text-base font-medium ${colorClass}`}>
        {value.toFixed(2)}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
