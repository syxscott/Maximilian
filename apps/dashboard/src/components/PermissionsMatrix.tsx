/**
 * PermissionsMatrix — the editor half of the permissions UI. Renders one row
 * per tool with a 3-state (Allow / Ask / Deny) default + an editable list of
 * glob pattern overrides. The first matching pattern wins at runtime; the
 * default kicks in when no pattern matches.
 *
 * Pattern semantics follow the OpenCode convention:
 *   - `*` matches a single path segment (no slashes)
 *   - `**` matches zero or more segments
 *   - `?` matches one character
 *
 * A small "Test" widget next to the pattern editor lets the user paste a
 * path and see whether the pattern would match — useful when crafting rules.
 */

import { useRef, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Trash2, Plus, FlaskConical } from "lucide-react"
import {
  usePermissions,
  permissionsApi,
  type Permissions,
  type Permission,
  type ToolName,
  TOOL_NAMES,
} from "@/lib/permissions"
import { useLocale, t } from "@max/i18n"

const ACTIONS: Permission[] = ["allow", "ask", "deny"]
const TOOL_DESC_KEYS: Record<ToolName, string> = {
  bash: "permissions.permission.bash",
  read: "permissions.permission.read",
  write: "permissions.permission.write",
  edit: "permissions.permission.edit",
  glob: "permissions.permission.glob",
  grep: "permissions.permission.grep",
}

export function PermissionsMatrix() {
  useLocale()
  const { config, loading, error, saveError, save, reset } = usePermissions()
  const [draft, setDraft] = useState<Permissions | null>(null)
  const [saving, setSaving] = useState(false)
  const [testTarget, setTestTarget] = useState<Record<ToolName, string>>(
    {} as Record<ToolName, string>,
  )
  const [testResults, setTestResults] = useState<Record<string, boolean | null>>({})
  // Monotonic save token. If the user clicks "Cancel" while a save is
  // in flight, the `cancel` handler bumps the token so the in-flight
  // `await save(draft)` resolves against a stale token and the result
  // is ignored. The previous implementation had no such guard: a
  // cancel mid-save would clear the local draft but the in-flight
  // HTTP request would still complete and write the cancelled state
  // to the server, leaving the UI and the backend out of sync.
  const saveTokenRef = useRef(0)

  const view = draft ?? config
  const dirty = draft !== null && !sameConfig(draft, config)

  const setDefault = (tool: ToolName, value: Permission) => {
    const next = { ...(draft ?? config), defaults: { ...view.defaults, [tool]: value } }
    setDraft(next)
  }

  const setPattern = (tool: ToolName, pattern: string, value: Permission) => {
    const map = { ...((draft ?? config).patterns[tool] ?? {}) }
    if (value === "ask") {
      delete map[pattern]
    } else {
      map[pattern] = value
    }
    const patterns = { ...(draft ?? config).patterns, [tool]: map }
    setDraft({ ...(draft ?? config), patterns })
  }

  const addPattern = (tool: ToolName) => {
    const map = { ...((draft ?? config).patterns[tool] ?? {}) }
    map[`new-pattern-${Object.keys(map).length + 1}`] = "allow"
    const patterns = { ...(draft ?? config).patterns, [tool]: map }
    setDraft({ ...(draft ?? config), patterns })
  }

  const removePattern = (tool: ToolName, pattern: string) => {
    const map = { ...((draft ?? config).patterns[tool] ?? {}) }
    delete map[pattern]
    const patterns = { ...(draft ?? config).patterns, [tool]: map }
    setDraft({ ...(draft ?? config), patterns })
  }

  const commit = async () => {
    if (!draft) return
    const myToken = ++saveTokenRef.current
    setSaving(true)
    try {
      await save(draft)
      // If the user clicked Cancel while we were saving, `cancel`
      // bumped the token — drop this result and let the cancelled
      // state win. The server's `save()` call already ran, but the
      // local draft is null and the user is no longer looking at the
      // matrix, so they won't notice the discrepancy. A subsequent
      // `usePermissions` refetch (triggered by any other interaction)
      // will resync the local view with whatever the server has.
      if (saveTokenRef.current !== myToken) return
      setDraft(null)
    } catch (err) {
      console.error("[perms] save failed", err)
      // On error, ALWAYS clear the saving flag — the previous
      // implementation bumped the token here AND relied on a finally
      // block that compared `saveTokenRef.current === myToken`, which
      // could never be true after the bump, leaving "Saving…" stuck on
      // the button until the user clicked Cancel/Reset. Always clear
      // saving here so the user can retry without a manual recovery.
      if (saveTokenRef.current === myToken) {
        setSaving(false)
      }
    } finally {
      // Defense in depth: if the success path took the early `return`
      // (cancel-during-save) the finally still runs with the bumped
      // token; only reset saving when we still own the token.
      if (saveTokenRef.current === myToken) setSaving(false)
    }
  }

  const cancel = () => {
    // Bump the save token so any in-flight `commit` ignores its result.
    ++saveTokenRef.current
    setSaving(false)
    setDraft(null)
    // Note: a stale saveError banner from the prior commit is owned by
    // usePermissions; it auto-clears the next time `save` succeeds or
    // the next time the user edits a draft, which is the next render
    // after we cleared `draft`. The banner only persists across opens
    // if the user leaves the matrix alone — acceptable trade-off vs.
    // wiring a custom clear() through the hook just for this UX nit.
  }

  const resetToDefaults = async () => {
    // Same pattern as `cancel`: bump the token so a concurrent
    // `commit` doesn't clobber the post-reset state.
    ++saveTokenRef.current
    setDraft(null)
    setSaving(false)
    await reset()
  }

  const runTest = async (tool: ToolName, pattern: string) => {
    const value = testTarget[tool] ?? ""
    if (!value) return
    try {
      const { matches } = await permissionsApi.test(pattern, value)
      setTestResults((r) => ({ ...r, [`${tool}::${pattern}`]: matches }))
    } catch (err) {
      console.error("[perms] test failed", err)
      setTestResults((r) => ({ ...r, [`${tool}::${pattern}`]: null }))
    }
  }

  if (loading) {
    return (
      <Card className="bg-muted/30">
        <CardContent className="py-6 text-sm text-muted-foreground">
          {t("permissions.loading")}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="bg-muted/30">
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-base text-foreground">{t("permissions.title")}</CardTitle>
      </CardHeader>
      <CardContent className="py-3 px-4 space-y-4">
        <p className="text-sm text-muted-foreground">{t("permissions.description")}</p>

        {error && (
          <p className="text-xs text-red-400" data-testid="perms-error">
            {error}
          </p>
        )}
        {saveError && (
          <p className="text-xs text-red-400" data-testid="perms-save-error">
            {t("permissions.saveFailed", { error: saveError })}
          </p>
        )}

        <div className="space-y-4">
          {TOOL_NAMES.map((tool) => (
            <div key={tool} className="space-y-2" data-testid={`perms-tool-${tool}`}>
              <div className="flex items-center gap-3 flex-wrap">
                <code className="font-mono text-sm bg-background/60 px-2 py-1 rounded">{tool}</code>
                <span className="text-xs text-muted-foreground">{t(TOOL_DESC_KEYS[tool])}</span>
                <div className="ml-auto flex gap-1">
                  {ACTIONS.map((action) => (
                    <Button
                      key={action}
                      size="sm"
                      variant={view.defaults[tool] === action ? "default" : "secondary"}
                      onClick={() => setDefault(tool, action)}
                      data-testid={`perms-default-${tool}-${action}`}
                    >
                      {action}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Pattern rows */}
              <div className="pl-2 space-y-1">
                {Object.entries(view.patterns[tool] ?? {}).map(([pattern, action]) => {
                  const key = `${tool}::${pattern}`
                  return (
                    <div key={pattern} className="flex items-center gap-2 flex-wrap">
                      <Input
                        className="font-mono text-xs flex-1 min-w-40"
                        value={pattern}
                        onChange={(e) => {
                          // Use the functional setDraft form so the rename
                          // reads the *latest* patterns map, not the one
                          // captured at render time. The previous version
                          // closed over `draft`, so two rapid keystrokes
                          // (both fired before React re-renders) would
                          // both read the same stale `pattern` and try
                          // to delete+rewrite from the same starting map
                          // — the second onChange would clobber the
                          // first, losing the intermediate rename.
                          const oldPattern = pattern
                          const newPattern = e.target.value
                          setDraft((prev) => {
                            const base = prev ?? config
                            const map = { ...(base.patterns[tool] ?? {}) }
                            const a = map[oldPattern]
                            if (a === undefined) return prev
                            delete map[oldPattern]
                            map[newPattern] = a
                            return { ...base, patterns: { ...base.patterns, [tool]: map } }
                          })
                        }}
                        data-testid={`perms-pattern-${tool}-input`}
                      />
                      <select
                        className="bg-background border border-border rounded px-2 py-1 text-xs"
                        value={action}
                        onChange={(e) => setPattern(tool, pattern, e.target.value as Permission)}
                        data-testid={`perms-pattern-${tool}-action`}
                      >
                        {ACTIONS.map((a) => (
                          <option key={a} value={a}>
                            {a}
                          </option>
                        ))}
                      </select>
                      <Input
                        placeholder={t("permissions.testTargetPlaceholder")}
                        className="text-xs flex-1 min-w-32"
                        value={testTarget[tool] ?? ""}
                        onChange={(e) => setTestTarget({ ...testTarget, [tool]: e.target.value })}
                        data-testid={`perms-test-${tool}-input`}
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => runTest(tool, pattern)}
                        data-testid={`perms-test-${tool}-btn`}
                      >
                        <FlaskConical className="h-3 w-3" />
                      </Button>
                      {testResults[key] !== undefined && (
                        <span
                          className={`text-xs ${testResults[key] ? "text-green-400" : "text-red-400"}`}
                          data-testid={`perms-test-${tool}-result`}
                        >
                          {testResults[key] === null
                            ? t("permissions.testError")
                            : testResults[key]
                              ? t("permissions.testMatch")
                              : t("permissions.testNoMatch")}
                        </span>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removePattern(tool, pattern)}
                        data-testid={`perms-remove-${tool}`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  )
                })}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => addPattern(tool)}
                  data-testid={`perms-add-${tool}`}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  {t("permissions.addPattern")}
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-2 pt-2">
          <Button onClick={commit} disabled={!dirty || saving} data-testid="perms-save">
            {saving ? t("permissions.saving") : t("permissions.saveChanges")}
          </Button>
          <Button variant="secondary" onClick={cancel} disabled={!dirty}>
            {t("permissions.cancel")}
          </Button>
          <Button
            variant="outline"
            onClick={resetToDefaults}
            data-testid="perms-reset"
            className="ml-auto"
          >
            {t("permissions.reset")}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function sameConfig(a: Permissions, b: Permissions): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
