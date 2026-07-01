import { Suspense, lazy, useState, useEffect, useRef, useCallback } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Toaster } from "@/components/ui/sonner";
import { useHealth } from "@/lib/api/hooks";
import { useLocale, t } from "@max/i18n";
import { chatApi } from "./api";
import type { Workspace, RuntimeEvent } from "./api";
import { ChatPanel } from "./components/ChatPanel";
import { AgentPanel } from "./components/AgentPanel";
import { TaskPanel } from "./components/TaskPanel";
import { OutputPanel } from "./components/OutputPanel";
import { ReviewPanel } from "./components/ReviewPanel";
import { ThemeToggle } from "./components/ThemeToggle";
import { PermissionDialog } from "./components/PermissionDialog";
import { permissionsApi, type PendingPermission } from "./lib/permissions";
import { usePerfTier } from "./lib/perf-tier";

// Lazy-load the heavier panels so the initial bundle stays light. On high
// perf tier, eager loading is fine but lazy still saves parse time on first
// paint — keeping it lazy universally simplifies the wiring.
const ExecutionCanvas = lazy(() => import("./components/ExecutionCanvas").then((m) => ({ default: m.ExecutionCanvas })));
const GovernancePortal = lazy(() => import("./components/GovernancePortal").then((m) => ({ default: m.GovernancePortal })));
const EvolutionTree = lazy(() => import("./components/EvolutionTree").then((m) => ({ default: m.EvolutionTree })));
const ProviderPanel = lazy(() => import("./components/ProviderPanel").then((m) => ({ default: m.ProviderPanel })));
const UsagePanel = lazy(() => import("./components/UsagePanel").then((m) => ({ default: m.UsagePanel })));
const SettingsPanel = lazy(() => import("./components/SettingsPanel").then((m) => ({ default: m.SettingsPanel })));

type Tab = "workspace" | "executions" | "governance" | "evolution" | "providers" | "usage" | "settings";

function TabFallback({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
      {t("common.loading")}
    </div>
  );
}

export function App() {
  const [tab, setTab] = useState<Tab>("workspace");
  const { data: health, error: healthError } = useHealth();
  // Subscribe to locale changes so tabs (and any other t() calls below)
  // re-render when the user switches language in Settings.
  useLocale();
  // Surface perf tier in devtools — also ensures the tier class lands on
  // <html> before any tab paints its heavy components.
  usePerfTier();

  // Workspace state
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [events, setEvents] = useState<RuntimeEvent[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  // Used to cancel an in-flight POST when the user re-submits. SSE itself
  // can't be aborted (browser API doesn't allow it), but the chat request
  // can, and we close the previous EventSource in stopStream().
  const abortRef = useRef<AbortController | null>(null);
  // Latest un-answered permission prompt. We track the requestId so the
  // answer call always pairs with the event the user actually saw.
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null);
  // Consecutive error count for the current EventSource. The browser
  // auto-reconnects on transient failure and resends `Last-Event-ID` so the
  // server can replay missed events — but for permanent failures (404,
  // 403, repeated 5xx) we cap retries and close the stream so the UI
  // doesn't spin forever.
  const sseErrorCount = useRef(0);
  const SSE_MAX_RETRIES = 5;

  const stopStream = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }, []);

  useEffect(() => () => stopStream(), [stopStream]);

  async function handleSubmit(message: string) {
    // Cancel any in-flight request and close any open stream first. Without
    // this, rapid clicks on the Send button would open N parallel SSE
    // connections and leak EventSources when the user navigates away mid-stream.
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    stopStream();

    setSubmitting(true);
    try {
      const { workspaceId } = await chatApi.chat(message, abortRef.current.signal);
      setEvents([]);

      const es = new EventSource(`/api/workspaces/${encodeURIComponent(workspaceId)}/stream`);
      esRef.current = es;
      sseErrorCount.current = 0;

      es.onmessage = (e) => {
        // A successful message resets the retry counter — the connection
        // is healthy and we should tolerate the next transient failure.
        sseErrorCount.current = 0;
        try {
          const data = JSON.parse(e.data);
          if (data.type === "workspace") {
            setWorkspace(data.workspace);
          } else if (data.type === "event") {
            const ev = data.event as { type?: string } & Record<string, unknown>;
            setEvents((prev) => [...prev, ev as RuntimeEvent]);
            if (ev.type === "permission-request") {
              setPendingPermission({
                kind: "permission",
                requestId: ev.requestId as string,
                workspaceId: ev.workspaceId as string,
                taskId: ev.taskId as string,
                tool: ev.tool as string,
                target: ev.target as string,
              });
            } else if (ev.type === "permission-resolved") {
              setPendingPermission((p) =>
                p && p.requestId === ev.requestId ? null : p,
              );
            } else if (ev.type === "approval-request") {
              setPendingPermission({
                kind: "approval",
                requestId: ev.requestId as string,
                workspaceId: ev.workspaceId as string,
                taskId: ev.taskId as string,
                prompt: ev.prompt as string,
                reason: ev.reason as string | undefined,
                requireComment: ev.requireComment as boolean | undefined,
              });
            } else if (ev.type === "approval-resolved") {
              setPendingPermission((p) =>
                p && p.requestId === ev.requestId ? null : p,
              );
            }
          } else if (data.type === "done") {
            es.close();
            esRef.current = null;
          }
        } catch (err) {
          console.error("SSE parse error", err);
        }
      };

      es.onerror = () => {
        // The browser's EventSource auto-reconnects after a transient
        // failure and resends `Last-Event-ID` so the server can replay
        // missed events. We let it retry up to SSE_MAX_RETRIES; beyond
        // that we close the stream so the UI doesn't spin forever on a
        // permanent failure (404, 403, repeated 5xx).
        sseErrorCount.current += 1;
        if (sseErrorCount.current >= SSE_MAX_RETRIES) {
          console.warn(
            `SSE gave up after ${sseErrorCount.current} consecutive errors`,
          );
          if (esRef.current === es) {
            es.close();
            esRef.current = null;
          }
          setSubmitting(false);
        } else {
          console.warn(
            `SSE connection error (auto-reconnecting, attempt ${sseErrorCount.current}/${SSE_MAX_RETRIES})`,
          );
          // Release the submitting lock so the UI shows a recoverable
          // state, but keep the EventSource open for the browser's
          // built-in backoff retry.
          setSubmitting(false);
        }
      };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      console.error("chat error", err);
      stopStream();
    } finally {
      // Only flip submitting off if this request is still the active one
      // (a newer submission may have already taken over).
      if (!abortRef.current?.signal.aborted) {
        setSubmitting(false);
      }
    }
  }

  const answerPermission = useCallback(
    async (decision: "allow" | "deny") => {
      if (!pendingPermission || pendingPermission.kind !== "permission") return;
      const id = pendingPermission.requestId;
      try {
        await permissionsApi.answer(id, decision);
      } catch (err) {
        console.error("[perms] answer failed", err);
      } finally {
        // Clear locally even if the API rejected; the user has acted and we
        // shouldn't keep the dialog open. A subsequent permission-resolved
        // event is idempotent.
        setPendingPermission(null);
      }
    },
    [pendingPermission],
  );

  const answerApproval = useCallback(
    async (decision: "approve" | "reject") => {
      if (!pendingPermission || pendingPermission.kind !== "approval") return;
      const id = pendingPermission.requestId;
      try {
        await permissionsApi.answerApproval(id, decision);
      } catch (err) {
        console.error("[approvals] answer failed", err);
      } finally {
        setPendingPermission(null);
      }
    },
    [pendingPermission],
  );

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <Toaster />
      <PermissionDialog pending={pendingPermission} onAnswer={answerPermission} onApprovalAnswer={answerApproval} />

      {/* Header */}
      <header className="border-b border-border px-6 py-3 flex items-center justify-between bg-muted/30">
        <h1 className="text-xl font-semibold">
          Maximilian <span className="text-muted-foreground text-base font-medium">{t("app.subtitle")}</span>
        </h1>
        <div className="flex items-center gap-3">
          {healthError ? (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <span className="inline-block w-2 h-2 rounded-full bg-destructive" />
              <span>{t("app.backendUnreachable")}</span>
            </div>
          ) : health ? (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span className={`inline-block w-2 h-2 rounded-full ${health.status === "ok" ? "bg-green-500" : "bg-destructive"}`} />
              <span>Telemetry: {health.telemetry}</span>
              <span>Meta: {health.metaAgent}</span>
              <span>{health.providers.length} providers</span>
            </div>
          ) : null}
          <ThemeToggle />
        </div>
      </header>

      {/* Tab bar */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <nav className="px-6 border-b border-border bg-background">
          <TabsList>
            <TabsTrigger value="workspace">{t("nav.workspace")}</TabsTrigger>
            <TabsTrigger value="executions">{t("nav.executions")}</TabsTrigger>
            <TabsTrigger value="governance">{t("nav.governance")}</TabsTrigger>
            <TabsTrigger value="evolution">{t("nav.evolution")}</TabsTrigger>
            <TabsTrigger value="usage">{t("nav.usage")}</TabsTrigger>
            <TabsTrigger value="providers">{t("nav.providers")}</TabsTrigger>
            <TabsTrigger value="settings">{t("nav.settings")}</TabsTrigger>
          </TabsList>
        </nav>

        <main className="flex-1 overflow-auto p-6">
          <TabsContent value="workspace">
            <div className="h-[calc(100vh-8rem)] rounded-lg border border-border bg-card overflow-hidden">
              <ChatPanel
                onSubmit={handleSubmit}
                submitting={submitting}
                workspace={workspace}
                sidebar={
                  <div className="flex flex-col gap-4">
                    <AgentPanel workspace={workspace} events={events} />
                    <TaskPanel workspace={workspace} />
                    {workspace?.review ? (
                      <ReviewPanel workspace={workspace} />
                    ) : (
                      <OutputPanel workspace={workspace} />
                    )}
                  </div>
                }
              />
            </div>
          </TabsContent>
          <TabsContent value="executions">
            <Suspense fallback={<TabFallback label={t("nav.executions")} />}>
              <ExecutionCanvas />
            </Suspense>
          </TabsContent>
          <TabsContent value="governance">
            <Suspense fallback={<TabFallback label={t("nav.governance")} />}>
              <GovernancePortal />
            </Suspense>
          </TabsContent>
          <TabsContent value="evolution">
            <Suspense fallback={<TabFallback label={t("nav.evolution")} />}>
              <EvolutionTree />
            </Suspense>
          </TabsContent>
          <TabsContent value="providers">
            <Suspense fallback={<TabFallback label={t("nav.providers")} />}>
              <ProviderPanel />
            </Suspense>
          </TabsContent>
          <TabsContent value="usage">
            <Suspense fallback={<TabFallback label={t("nav.usage")} />}>
              <UsagePanel />
            </Suspense>
          </TabsContent>
          <TabsContent value="settings">
            <Suspense fallback={<TabFallback label={t("nav.settings")} />}>
              <SettingsPanel />
            </Suspense>
          </TabsContent>
        </main>
      </Tabs>

      {/* Workspace footer */}
      {tab === "workspace" && (
        <footer className="px-6 py-1.5 text-xs flex gap-4 border-t border-border bg-muted/30 text-muted-foreground">
          <span>Status: {workspace?.status ?? "idle"}</span>
          <span>{t("footer.workspace")}: {workspace?.id ?? t("footer.workspaceNone")}</span>
          <span>{t("task.title")}: {workspace?.plan?.tasks.length ?? 0}</span>
        </footer>
      )}
    </div>
  );
}
