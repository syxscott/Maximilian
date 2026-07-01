import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Sidebar: session metadata panel (title, workspace, share URL, version).
 *
 * Ported from OpenCode's SolidJS `sidebar.tsx`. The original used
 * `createMemo`, `<Show>`, `<scrollbox>`, and plugin runtime slots.
 * We port to React `useMemo`, conditional JSX, and ink `<Box>` primitives.
 * Plugin runtime slots are rendered as no-ops (the stub Slot returns null).
 */
import { useMemo } from "react";
import { Box, Text } from "ink";
import { useSync } from "../../context/sync";
import { useTheme } from "../../context/theme";
import { useProject } from "../../context/project";
import { usePluginRuntime } from "../../context";
import { WorkspaceLabel } from "../../components/workspace-label";
export function Sidebar(props) {
    const pluginRuntime = usePluginRuntime();
    const project = useProject();
    const sync = useSync();
    const { theme } = useTheme();
    const session = useMemo(() => sync.data.session.find((s) => s.id === props.sessionID), [sync.data.session, props.sessionID]);
    const workspace = useMemo(() => {
        const workspaceID = session?.workspaceID;
        if (!workspaceID)
            return undefined;
        return project.workspace.get(workspaceID);
    }, [session?.workspaceID, project]);
    if (!session)
        return null;
    const Slot = pluginRuntime.Slot;
    return (_jsxs(Box, { flexDirection: "column", width: 42, height: "100%", paddingTop: 1, paddingBottom: 1, paddingLeft: 2, paddingRight: 2, borderStyle: "single", borderColor: theme.border, children: [_jsxs(Box, { flexDirection: "column", flexShrink: 0, gap: 1, paddingRight: 1, children: [_jsx(Slot, { name: "sidebar_title" }), _jsxs(Box, { paddingRight: 1, flexDirection: "column", children: [_jsx(Text, { bold: true, color: theme.text, children: session.title ?? "Untitled" }), session.workspaceID ? (_jsx(Text, { dimColor: true, children: workspace ? (_jsx(WorkspaceLabel, { type: workspace.type ?? "unknown", name: workspace.id, status: project.workspace.status?.(workspace.id) ?? "error", icon: true })) : (_jsx(WorkspaceLabel, { type: "unknown", name: session.workspaceID, status: "error", icon: true })) })) : null, session.share?.url ? _jsx(Text, { dimColor: true, children: session.share.url }) : null] }), _jsx(Slot, { name: "sidebar_content" })] }), _jsxs(Box, { flexShrink: 0, gap: 1, paddingTop: 1, children: [_jsx(Slot, { name: "sidebar_footer" }), _jsxs(Text, { dimColor: true, children: [_jsx(Text, { color: theme.success, children: "*" }), " ", _jsx(Text, { bold: true, children: "Open" }), _jsx(Text, { bold: true, children: "Code" })] })] })] }));
}
