// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * OracleLessonsEditor — the oracle settings section: the read-only corpus
 * browser (role cards with content preview) plus real curation. "Edit"
 * opens an inline textarea over one role's markdown and saves through
 * PUT /evolution/oracle-lessons/{role}; a create row mints a brand-new
 * role file. Role names are validated locally with the same whitelist the
 * server enforces; save outcomes surface as an inline line per role —
 * success in muted text, failure with the server's reason.
 */

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useLocale, t } from "@max/i18n"
import { systemApi } from "@/api"
import { ORACLE_LESSONS_QUERY_KEY, useSaveOracleLesson } from "@/hooks/useSettingsQueries"
import {
  oracleSaveErrorKind,
  toOracleCorpusView,
  validateOracleRoleName,
  type OracleLessonView,
  type OracleRoleError,
} from "./model"

/** Which lesson editor is open (at most one at a time). */
type EditorState =
  | { kind: "closed" }
  | { kind: "edit"; role: string; content: string }
  | { kind: "create"; role: string; content: string }

/** Inline save outcome shown under the edited lesson. */
type SaveState =
  | { kind: "idle" }
  | { kind: "ok"; role: string; bytes: number }
  | { kind: "error"; role: string; message: string }

export function OracleLessonsEditor() {
  useLocale()
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: [...ORACLE_LESSONS_QUERY_KEY],
    queryFn: ({ signal }) => systemApi.oracleLessons(signal),
    staleTime: 60_000,
  })
  const saveMutation = useSaveOracleLesson()

  const corpus = toOracleCorpusView(data)
  const [editor, setEditor] = useState<EditorState>({ kind: "closed" })
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" })
  const [newRole, setNewRole] = useState("")
  const [newRoleError, setNewRoleError] = useState<OracleRoleError | null>(null)

  const startEdit = (lesson: OracleLessonView) => {
    setSaveState({ kind: "idle" })
    setEditor({ kind: "edit", role: lesson.role, content: lesson.content })
  }

  const startCreate = () => {
    const error = validateOracleRoleName(newRole)
    setNewRoleError(error)
    if (error !== null) return
    setSaveState({ kind: "idle" })
    setEditor({ kind: "create", role: newRole, content: "" })
    setNewRole("")
  }

  const save = async () => {
    if (editor.kind === "closed") return
    const role = editor.role
    try {
      const saved = await saveMutation.mutateAsync({ role, content: editor.content })
      setSaveState({ kind: "ok", role, bytes: saved.bytes })
      setEditor({ kind: "closed" })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setSaveState({ kind: "error", role, message })
    }
  }

  const roleErrorText = (code: OracleRoleError) => t(`settingsDeep.oracleEditor.role.${code}`)

  return (
    <Card data-testid="settings-oracle">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t("settings.oracle.title")}</CardTitle>
        <p className="text-xs text-muted-foreground">
          {t("settingsDeep.oracleEditor.description")}
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <p className="text-xs text-muted-foreground">{t("settingsDeep.common.loading")}</p>
        ) : isError ? (
          <div className="space-y-2">
            <p className="text-xs text-destructive">{t("settingsDeep.common.error")}</p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              {t("settingsDeep.common.retry")}
            </Button>
          </div>
        ) : (
          <>
            {!corpus.configured && (
              <p className="text-xs text-muted-foreground">{t("settings.oracle.notConfigured")}</p>
            )}
            {corpus.configured && corpus.dir && (
              <p className="break-all font-mono text-[10px] text-muted-foreground">{corpus.dir}</p>
            )}
            {corpus.lessons.length === 0 && corpus.configured && (
              <p className="text-xs text-muted-foreground">{t("settings.oracle.empty")}</p>
            )}

            {corpus.lessons.map((lesson) => {
              const editing = editor.kind === "edit" && editor.role === lesson.role ? editor : null
              return (
                <div key={lesson.role} className="rounded border px-2 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs">
                      {lesson.role}{" "}
                      <span className="text-muted-foreground">· {lesson.bytes} B</span>
                    </span>
                    {editing === null && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-[10px]"
                        onClick={() => startEdit(lesson)}
                        data-testid={`oracle-edit-${lesson.role}`}
                      >
                        {t("settingsDeep.oracleEditor.edit")}
                      </Button>
                    )}
                  </div>

                  {editing === null ? (
                    <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
                      {lesson.content}
                    </pre>
                  ) : (
                    <div className="mt-1 space-y-2" data-testid={`oracle-editor-${lesson.role}`}>
                      <Textarea
                        value={editing.content}
                        onChange={(e) =>
                          setEditor({ kind: "edit", role: editing.role, content: e.target.value })
                        }
                        className="min-h-[120px] font-mono text-xs"
                        aria-label={t("settingsDeep.oracleEditor.editorLabel", {
                          role: editing.role,
                        })}
                      />
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={() => void save()}
                          disabled={saveMutation.isPending || editing.content.trim().length === 0}
                          data-testid={`oracle-save-${lesson.role}`}
                        >
                          {saveMutation.isPending
                            ? t("settingsDeep.oracleEditor.saving")
                            : t("settingsDeep.oracleEditor.save")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditor({ kind: "closed" })
                            setSaveState({ kind: "idle" })
                          }}
                        >
                          {t("settingsDeep.oracleEditor.cancel")}
                        </Button>
                      </div>
                    </div>
                  )}

                  <InlineSaveState state={saveState} role={lesson.role} />
                </div>
              )
            })}

            {/* Create: a brand-new role file in the configured directory. */}
            {corpus.configured && (
              <div className="flex flex-wrap items-center gap-2 pt-1" data-testid="oracle-create">
                {editor.kind === "create" ? (
                  <div className="w-full space-y-2">
                    <p className="font-mono text-xs">
                      {editor.role}{" "}
                      <span className="text-muted-foreground">
                        · {t("settingsDeep.oracleEditor.newRoleBadge")}
                      </span>
                    </p>
                    <Textarea
                      value={editor.content}
                      onChange={(e) =>
                        setEditor({ kind: "create", role: editor.role, content: e.target.value })
                      }
                      className="min-h-[120px] font-mono text-xs"
                      placeholder={t("settingsDeep.oracleEditor.newContentPlaceholder")}
                      aria-label={t("settingsDeep.oracleEditor.editorLabel", { role: editor.role })}
                      data-testid="oracle-create-textarea"
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() => void save()}
                        disabled={saveMutation.isPending || editor.content.trim().length === 0}
                        data-testid="oracle-create-save"
                      >
                        {saveMutation.isPending
                          ? t("settingsDeep.oracleEditor.saving")
                          : t("settingsDeep.oracleEditor.save")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditor({ kind: "closed" })
                          setSaveState({ kind: "idle" })
                        }}
                      >
                        {t("settingsDeep.oracleEditor.cancel")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <Input
                      value={newRole}
                      onChange={(e) => {
                        setNewRole(e.target.value)
                        setNewRoleError(null)
                      }}
                      placeholder={t("settingsDeep.oracleEditor.newRolePlaceholder")}
                      className="h-8 max-w-48 font-mono text-xs"
                      aria-label={t("settingsDeep.oracleEditor.newRolePlaceholder")}
                      data-testid="oracle-new-role-input"
                    />
                    <Button size="sm" variant="outline" onClick={startCreate}>
                      {t("settingsDeep.oracleEditor.create")}
                    </Button>
                    {newRoleError !== null && (
                      <span
                        className="text-xs text-destructive"
                        data-testid="oracle-new-role-error"
                      >
                        {roleErrorText(newRoleError)}
                      </span>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

/** Inline per-role outcome line; renders nothing when idle/foreign role. */
function InlineSaveState({ state, role }: { state: SaveState; role: string }) {
  if (state.kind === "idle" || state.role !== role) return null
  if (state.kind === "ok") {
    return (
      <p className="mt-1 text-xs text-muted-foreground" data-testid={`oracle-saved-${role}`}>
        {t("settingsDeep.oracleEditor.saved", { bytes: String(state.bytes) })}
      </p>
    )
  }
  const kind = oracleSaveErrorKind(new Error(state.message))
  return (
    <p className="mt-1 text-xs text-destructive" data-testid={`oracle-error-${role}`}>
      {t(`settingsDeep.oracleEditor.saveFailed.${kind}`)}
      <span className="ml-1 font-mono text-[10px]">{state.message}</span>
    </p>
  )
}
