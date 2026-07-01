import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// @ts-nocheck
/**
 * DialogTimeline: scrollable list of user messages in a session.
 *
 * Ported from OpenCode's SolidJS `dialog-timeline.tsx`. The original used
 * `<DialogSelect>` and `createMemo` for lazy option computation; we rebuild
 * the list UI with ink primitives and `useMemo`.
 */
import { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { useSync } from "../../context/sync";
import { useDialog } from "../../components/dialog";
import { Locale } from "../../util/locale";
import { DialogMessage } from "./dialog-message";
export function DialogTimeline(props) {
    const sync = useSync();
    const dialog = useDialog();
    const [selected, setSelected] = useState(0);
    useEffect(() => {
        dialog.setSize("large");
    }, [dialog]);
    const options = useMemo(() => {
        const messages = sync.data.message?.[props.sessionID] ?? [];
        const result = [];
        for (const message of messages) {
            if (message.role !== "user")
                continue;
            const parts = (sync.data.part?.[message.id] ?? []);
            const part = parts.find((x) => x.type === "text" && !x.synthetic && !x.ignored);
            if (!part)
                continue;
            result.push({
                title: part.text.replace(/\n/g, " "),
                value: message.id,
                footer: Locale.time(message.time.created),
            });
        }
        result.reverse();
        return result;
    }, [sync.data.message, sync.data.part, props.sessionID]);
    useInput((_input, key) => {
        if (key.up) {
            setSelected((prev) => (prev - 1 + options.length) % options.length);
        }
        else if (key.down) {
            setSelected((prev) => (prev + 1) % options.length);
        }
        else if (key.return) {
            const opt = options[selected];
            if (opt) {
                props.onMove(opt.value);
                dialog.replace(_jsx(DialogMessage, { messageID: opt.value, sessionID: props.sessionID, setPrompt: props.setPrompt }));
            }
        }
    });
    return (_jsxs(Box, { flexDirection: "column", paddingX: 2, paddingY: 1, children: [_jsx(Box, { marginBottom: 1, children: _jsx(Text, { bold: true, children: "Timeline" }) }), options.length === 0 ? (_jsx(Text, { dimColor: true, children: "No messages found." })) : (options.map((opt, i) => (_jsxs(Box, { flexDirection: "row", justifyContent: "space-between", children: [_jsxs(Text, { color: i === selected ? "green" : undefined, wrap: "truncate", children: [i === selected ? "> " : "  ", opt.title.length > 60 ? opt.title.slice(0, 59) + "…" : opt.title] }), opt.footer ? _jsxs(Text, { dimColor: true, children: [" ", opt.footer] }) : null] }, opt.value))))] }));
}
