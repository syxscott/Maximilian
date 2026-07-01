import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// @ts-nocheck
/**
 * DialogSubagent: action menu for a subagent session.
 *
 * Ported from OpenCode's SolidJS `dialog-subagent.tsx`. The original used
 * `<DialogSelect>` from `@opentui/solid`; we rebuild the same pattern with
 * ink primitives and `useInput`.
 */
import React, { useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { useRoute } from "../../context/route";
export function DialogSubagent(props) {
    const route = useRoute();
    const [selected, setSelected] = React.useState(0);
    const options = useMemo(() => [
        {
            title: "Open",
            value: "subagent.view",
            description: "the subagent's session",
            onSelect: () => {
                route.navigate({
                    type: "session",
                    sessionID: props.sessionID,
                });
            },
        },
    ], [props.sessionID, route]);
    useInput((_input, key) => {
        if (key.up) {
            setSelected((prev) => (prev - 1 + options.length) % options.length);
        }
        else if (key.down) {
            setSelected((prev) => (prev + 1) % options.length);
        }
        else if (key.return) {
            options[selected]?.onSelect();
        }
    });
    return (_jsxs(Box, { flexDirection: "column", paddingX: 2, paddingY: 1, children: [_jsx(Box, { marginBottom: 1, children: _jsx(Text, { bold: true, children: "Subagent Actions" }) }), options.map((opt, i) => (_jsxs(Box, { flexDirection: "row", children: [_jsxs(Text, { color: i === selected ? "green" : undefined, children: [i === selected ? "> " : "  ", opt.title] }), _jsxs(Text, { dimColor: true, children: [" - ", opt.description] })] }, opt.value)))] }));
}
