import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from "react";
import { t } from "@max/i18n";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
export function DialogWorkspaceList(props) {
    const [deleting, setDeleting] = useState(undefined);
    const [removing, setRemoving] = useState(undefined);
    const items = useMemo(() => {
        return [...props.workspaces]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((workspace) => ({
            label: removing === workspace.id
                ? "Deleting..."
                : deleting === workspace.id
                    ? `Delete ${workspace.name}? Press delete again`
                    : workspace.name,
            value: { workspace },
            footer: workspace.type,
            status: props.statusOf?.(workspace.id),
            directory: workspace.directory,
        }));
    }, [props.workspaces, removing, deleting, props.statusOf]);
    useInput((input, key) => {
        if (key.delete) {
            const ws = props.workspaces.find((w) => deleting === w.id);
            if (ws) {
                setDeleting(undefined);
                void (async () => {
                    setRemoving(ws.id);
                    try {
                        await props.onDelete?.(ws);
                    }
                    finally {
                        setRemoving(undefined);
                    }
                })();
            }
        }
    });
    return (_jsxs(Box, { flexDirection: "column", paddingX: 2, paddingY: 1, children: [_jsxs(Box, { flexDirection: "row", justifyContent: "space-between", children: [_jsx(Text, { bold: true, children: t("tui.workspaces") }), _jsx(Text, { dimColor: true, children: "esc" })] }), _jsx(Box, { marginTop: 1, children: _jsx(SelectInput, { items: items, onSelect: (item) => {
                        setDeleting((prev) => (prev === item.value.workspace.id ? prev : item.value.workspace.id));
                        props.onSelect?.(item.value.workspace);
                    }, itemComponent: ({ isSelected, label }) => (_jsx(Text, { color: isSelected ? "green" : undefined, children: label })) }) }), deleting && (_jsx(Box, { marginTop: 1, children: _jsx(Text, { color: "red", children: t("tui.confirmRemoval") }) }))] }));
}
export default DialogWorkspaceList;
