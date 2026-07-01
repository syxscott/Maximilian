import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { t } from "@max/i18n";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import SelectInput from "ink-select-input";
function recentConnectedWorkspaces(input) {
    const allWorkspaces = input.workspaces.filter((workspace) => input.status(workspace.id) === "connected");
    const workspaces = [...allWorkspaces].sort((a, b) => Number(b.timeUsed ?? 0) - Number(a.timeUsed ?? 0));
    const recent = workspaces.slice(0, input.limit ?? 3);
    return { recent, hasMore: recent.length < workspaces.length };
}
export function warpReminderText(dir) {
    return `<system-reminder>The user has changed the current working directory to "${dir}". This is still the same project but at a possibly new location; take this into account when working with any files from now on.</system-reminder>`;
}
export function DialogWorkspaceSelect(props) {
    const [adapters, setAdapters] = useState(props.adapters);
    const [view, setView] = useState("main");
    useEffect(() => {
        if (props.adapters && !adapters)
            setAdapters(props.adapters);
    }, [props.adapters, adapters]);
    const items = useMemo(() => {
        if (view === "existing") {
            const list = props.workspaces
                .filter((w) => props.statusOf?.(w.id) === "connected")
                .filter((w) => w.id !== props.omittedWorkspaceID)
                .map((workspace) => ({
                label: workspace.name,
                description: `(${workspace.type})`,
                value: {
                    type: "existing",
                    workspaceID: workspace.id,
                    workspaceType: workspace.type,
                    workspaceName: workspace.name,
                },
            }));
            return list;
        }
        const list = adapters;
        if (!list)
            return [];
        const { recent, hasMore } = recentConnectedWorkspaces({
            workspaces: props.workspaces,
            status: (id) => props.statusOf?.(id),
            omitWorkspaceID: props.omittedWorkspaceID,
        });
        const out = [
            ...list.map((adapter) => ({
                label: adapter.name,
                description: adapter.description,
                value: {
                    type: "new",
                    workspaceType: adapter.type,
                    workspaceName: adapter.name,
                },
            })),
            {
                label: "None",
                description: "Use the local project",
                value: { type: "none" },
            },
            ...recent.map((workspace) => ({
                label: workspace.name,
                description: `(${workspace.type})`,
                value: {
                    type: "existing",
                    workspaceID: workspace.id,
                    workspaceType: workspace.type,
                    workspaceName: workspace.name,
                },
            })),
        ];
        if (hasMore) {
            out.push({
                label: "View all workspaces",
                description: "Choose from all workspaces",
                value: { type: "existing-list" },
            });
        }
        return out;
    }, [adapters, view, props.workspaces, props.statusOf, props.omittedWorkspaceID]);
    if (!adapters)
        return _jsx(Text, { dimColor: true, children: "Loading adapters..." });
    return (_jsxs(Box, { flexDirection: "column", paddingX: 2, paddingY: 1, children: [_jsxs(Box, { flexDirection: "row", justifyContent: "space-between", children: [_jsx(Text, { bold: true, children: view === "main" ? "Warp" : "Existing Workspace" }), _jsx(Text, { dimColor: true, children: "esc" })] }), _jsx(Box, { marginTop: 1, children: _jsx(SelectInput, { items: items, onSelect: (item) => {
                        const v = item.value;
                        if (v.type === "existing-list") {
                            setView("existing");
                            props.onRequestExistingList?.();
                            return;
                        }
                        void props.onSelect?.(v);
                    } }) })] }));
}
export function DialogWorkspaceCreate(props) {
    const [name, setName] = useState("");
    useInput((input, key) => {
        if (key.escape)
            props.onCancel?.();
    });
    return (_jsxs(Box, { flexDirection: "column", paddingX: 2, paddingY: 1, children: [_jsxs(Box, { flexDirection: "row", justifyContent: "space-between", children: [_jsx(Text, { bold: true, children: t("tui.createWorkspace") }), _jsx(Text, { dimColor: true, children: "esc" })] }), _jsxs(Box, { marginTop: 1, children: [_jsx(Text, { children: "Name: " }), _jsx(TextInput, { value: name, onChange: setName, onSubmit: (value) => {
                            if (value.trim().length > 0)
                                props.onSubmit?.(value.trim());
                        } })] })] }));
}
export default DialogWorkspaceSelect;
