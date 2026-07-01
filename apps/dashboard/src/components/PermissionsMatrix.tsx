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

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Plus, FlaskConical } from "lucide-react";
import {
  usePermissions,
  permissionsApi,
  type Permissions,
  type Permission,
  type ToolName,
  TOOL_NAMES,
} from "@/lib/permissions";
import { useLocale, t } from "@max/i18n";

const ACTIONS: Permission[] = ["allow", "ask", "deny"];
const TOOL_DESC_KEYS: Record<ToolName, string> = {
  bash: "permissions.permission.bash",
  read: "permissions.permission.read",
  write: "permissions.permission.write",
  edit: "permissions.permission.edit",
  glob: "permissions.permission.glob",
  grep: "permissions.permission.grep",
};

export function PermissionsMatrix() {
  useLocale();
  const { config, loading, error, save, reset } = usePermissions();
  const [draft, setDraft] = useState<Permissions | null>(null);
  const [saving, setSaving] = useState(false);
  const [testTarget, setTestTarget] = useState<Record<ToolName, string>>({} as Record<ToolName, string>);
  const [testResults, setTestResults] = useState<Record<string, boolean | null>>({});

  const view = draft ?? config;
  const dirty = draft !== null && !sameConfig(draft, config);

  const setDefault = (tool: ToolName, value: Permission) => {
    const next = { ...(draft ?? config), defaults: { ...view.defaults, [tool]: value } };
    setDraft(next);
  };

  const setPattern = (tool: ToolName, pattern: string, value: Permission) => {
    const map = { ...((draft ?? config).patterns[tool] ?? {}) };
    if (value === "ask") {
      delete map[pattern];
    } else {
      map[pattern] = value;
    }
    const patterns = { ...(draft ?? config).patterns, [tool]: map };
    setDraft({ ...(draft ?? config), patterns });
  };

  const addPattern = (tool: ToolName) => {
    const map = { ...((draft ?? config).patterns[tool] ?? {}) };
    map[`new-pattern-${Object.keys(map).length + 1}`] = "allow";
    const patterns = { ...(draft ?? config).patterns, [tool]: map };
    setDraft({ ...(draft ?? config), patterns });
  };

  const removePattern = (tool: ToolName, pattern: string) => {
    const map = { ...((draft ?? config).patterns[tool] ?? {}) };
    delete map[pattern];
    const patterns = { ...(draft ?? config).patterns, [tool]: map };
    setDraft({ ...(draft ?? config), patterns });
  };

  const commit = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await save(draft);
      setDraft(null);
    } catch (err) {
      console.error("[perms] save failed", err);
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => setDraft(null);

  const resetToDefaults = async () => {
    setDraft(null);
    await reset();
  };

  const runTest = async (tool: ToolName, pattern: string) => {
    const value = testTarget[tool] ?? "";
    if (!value) return;
    try {
      const { matches } = await permissionsApi.test(pattern, value);
      setTestResults((r) => ({ ...r, [`${tool}::${pattern}`]: matches }));
    } catch (err) {
      console.error("[perms] test failed", err);
      setTestResults((r) => ({ ...r, [`${tool}::${pattern}`]: null }));
    }
  };

  if (loading) {
    return (
      <Card className="bg-muted/30">
        <CardContent className="py-6 text-sm text-muted-foreground">
          {t("permissions.loading")}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-muted/30">
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-base text-foreground">{t("permissions.title")}</CardTitle>
      </CardHeader>
      <CardContent className="py-3 px-4 space-y-4">
        <p className="text-sm text-muted-foreground">
          {t("permissions.description")}
        </p>

        {error && (
          <p className="text-xs text-red-400" data-testid="perms-error">
            {error}
          </p>
        )}

        <div className="space-y-4">
          {TOOL_NAMES.map((tool) => (
            <div key={tool} className="space-y-2" data-testid={`perms-tool-${tool}`}>
              <div className="flex items-center gap-3 flex-wrap">
                <code className="font-mono text-sm bg-background/60 px-2 py-1 rounded">
                  {tool}
                </code>
                <span className="text-xs text-muted-foreground">
                  {t(TOOL_DESC_KEYS[tool])}
                </span>
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
                  const key = `${tool}::${pattern}`;
                  return (
                    <div key={pattern} className="flex items-center gap-2 flex-wrap">
                      <Input
                        className="font-mono text-xs flex-1 min-w-40"
                        value={pattern}
                        onChange={(e) => {
                          const map = { ...((draft ?? config).patterns[tool] ?? {}) };
                          const a = map[pattern]!;
                          delete map[pattern];
                          map[e.target.value] = a;
                          const patterns = { ...(draft ?? config).patterns, [tool]: map };
                          setDraft({ ...(draft ?? config), patterns });
                        }}
                        data-testid={`perms-pattern-${tool}-input`}
                      />
                      <select
                        className="bg-background border border-border rounded px-2 py-1 text-xs"
                        value={action}
                        onChange={(e) =>
                          setPattern(tool, pattern, e.target.value as Permission)
                        }
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
                        onChange={(e) =>
                          setTestTarget({ ...testTarget, [tool]: e.target.value })
                        }
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
                          {testResults[key] === null ? t("permissions.testError") : testResults[key] ? t("permissions.testMatch") : t("permissions.testNoMatch")}
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
                  );
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
  );
}

function sameConfig(a: Permissions, b: Permissions): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
