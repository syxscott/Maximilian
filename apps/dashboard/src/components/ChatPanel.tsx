import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useLocale, t } from "@max/i18n";
import type { Workspace } from "../api";

const PRESET_KEYS = ["preset.todo", "preset.scraper", "preset.blog"] as const;

export function ChatPanel({
  onSubmit,
  submitting,
  workspace,
  sidebar,
  sidebarHidden,
}: {
  onSubmit: (message: string) => void;
  submitting: boolean;
  workspace: Workspace | null;
  /**
   * Optional sidebar content (workspace sidebar). When provided the
   * ChatPanel uses a CSS Grid layout with two columns: the conversation
   * on the left, the sidebar on the right. Mirrors OpenHands' layout.
   */
  sidebar?: React.ReactNode;
  /** Hide the sidebar even when `sidebar` is passed (e.g. on small screens). */
  sidebarHidden?: boolean;
}) {
  useLocale();
  const chatSchema = z.object({
    message: z
      .string()
      .trim()
      .min(1, t("chat.messageRequired"))
      .max(8000, t("chat.messageTooLong")),
  });
  type ChatForm = z.infer<typeof chatSchema>;
  const { register, handleSubmit, reset, watch, formState: { errors, isValid } } = useForm<ChatForm>({
    resolver: zodResolver(chatSchema),
    defaultValues: { message: "" },
    mode: "onChange",
  });

  const messageValue = watch("message");

  function submit(text?: string) {
    if (text) {
      onSubmit(text);
    } else {
      handleSubmit((data) => {
        onSubmit(data.message.trim());
        reset();
      })();
    }
  }

  const showSidebar = !!sidebar && !sidebarHidden;

  return (
    <div
      className="h-full p-4 gap-4"
      style={{
        display: "grid",
        gridTemplateColumns: showSidebar ? "minmax(0, 1fr) minmax(280px, 360px)" : "minmax(0, 1fr)",
        gridTemplateRows: "1fr",
      }}
    >
      {/* Main conversation column */}
      <div className="flex flex-col h-full min-w-0">
        <h2 className="text-lg font-semibold mb-2 text-foreground">{t("chat.title")}</h2>

        {!workspace && (
          <p className="text-muted-foreground text-sm mb-2">{t("chat.empty")}</p>
        )}

        <div className="flex-1 overflow-y-auto py-2 space-y-2">
          {workspace?.userRequest && (
            <Card className="border-blue-800/50 bg-blue-950/30">
              <CardContent className="py-2 px-3 text-sm">
                <Badge variant="outline" className="mr-2 border-blue-500 text-blue-400">{t("chat.you")}</Badge>
                <span className="text-foreground">{workspace.userRequest}</span>
              </CardContent>
            </Card>
          )}

          {workspace?.status === "completed" && workspace?.review && (
            <Card className="border-green-800/50 bg-green-950/30">
              <CardContent className="py-2 px-3 text-sm">
                <Badge variant="outline" className="mr-2 border-green-500 text-green-400">{t("chat.commander")}</Badge>
                <span className="text-foreground">
                  {t("chat.completed", { score: String(workspace.review.score) })}
                </span>
              </CardContent>
            </Card>
          )}

          {workspace?.status === "failed" && (
            <Card className="border-red-800/50 bg-red-950/30">
              <CardContent className="py-2 px-3 text-sm">
                <Badge variant="destructive" className="mr-2">{t("chat.error")}</Badge>
                <span className="text-foreground">
                  {t("chat.failed", { error: workspace.error ?? t("common.unknown") })}
                </span>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="pt-2 border-t border-border">
          <Textarea
            {...register("message")}
            rows={3}
            placeholder={t("chat.inputPlaceholder")}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
            }}
            className="resize-none bg-muted/50"
          />
          {errors.message && (
            <p className="text-sm text-destructive mt-1">{errors.message.message}</p>
          )}
          <div className="flex items-center justify-between mt-2">
            <div className="flex gap-1.5 flex-wrap">
              {PRESET_KEYS.map((key) => {
                const label = t(key);
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
                );
              })}
            </div>
            <Button
              onClick={() => submit()}
              disabled={submitting || !isValid || !messageValue?.trim()}
            >
              {submitting ? t("common.sending") : t("common.send")}
            </Button>
          </div>
        </div>
      </div>

      {/* Workspace sidebar column (OpenHands-style layout). */}
      {showSidebar && (
        <aside className="border border-border rounded-md p-3 overflow-y-auto bg-card/40 min-w-0">
          {sidebar}
        </aside>
      )}
    </div>
  );
}
