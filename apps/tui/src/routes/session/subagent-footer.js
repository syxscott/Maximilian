import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// @ts-nocheck
/**
 * SubagentFooter: bottom bar for subagent sessions with parent/prev/next nav.
 *
 * Ported from OpenCode's SolidJS `subagent-footer.tsx`. The original used
 * `createMemo`, `createSignal`, `Show`, `useTerminalDimensions`, and
 * `useCommandShortcut`/`useOpencodeKeymap` from keymap.
 *
 * We port to React `useMemo`, `useState`, conditional JSX, and ink
 * `Box`/`Text`. Keybindings are approximated via `useInput`. Mouse hover
 * is dropped (ink has no mouse events).
 */
import { useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { useRouteData } from "../../context/route";
import { useSync } from "../../context/sync";
import { useTheme } from "../../context/theme";
import { useOpencodeKeymap } from "../../context";
import { Locale } from "../../util/locale";
export function SubagentFooter() {
    const route = useRouteData("session");
    const sync = useSync();
    const { theme } = useTheme();
    const keymap = useOpencodeKeymap();
    const messages = useMemo(() => (sync.data.message?.[route.sessionID] ?? []), [sync.data.message, route.sessionID]);
    const session = useMemo(() => sync.data.session.find((s) => s.id === route.sessionID), [sync.data.session, route.sessionID]);
    const subagentInfo = useMemo(() => {
        const s = session;
        if (!s)
            return { label: "Subagent", index: 0, total: 0 };
        const agentMatch = s.title?.match?.(/@(\w+) subagent/);
        const label = agentMatch ? Locale.titlecase(agentMatch[1]) : "Subagent";
        if (!s.parentID)
            return { label, index: 0, total: 0 };
        const siblings = sync.data.session
            .filter((x) => x.parentID === s.parentID)
            .toSorted((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0));
        const index = siblings.findIndex((x) => x.id === s.id);
        return { label, index: index + 1, total: siblings.length };
    }, [session, sync.data.session]);
    const usage = useMemo(() => {
        const last = messages.findLast((item) => item.role === "assistant" && item.tokens?.output > 0);
        if (!last)
            return undefined;
        const tokens = last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write;
        if (tokens <= 0)
            return undefined;
        const provider = sync.data.provider.find((item) => item.id === last.providerID);
        const model = provider?.models?.[last.modelID ?? ""];
        const pct = model?.limit?.context ? `${Math.round((tokens / model.limit.context) * 100)}%` : undefined;
        const cost = session?.cost ?? 0;
        const money = new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
        });
        return {
            context: pct ? `${Locale.number(tokens)} (${pct})` : Locale.number(tokens),
            cost: cost > 0 ? money.format(cost) : undefined,
        };
    }, [messages, sync.data.provider, session]);
    useInput((input, _key) => {
        // Keyboard shortcuts for parent/prev/next navigation
        if (input === "p") {
            keymap.dispatchCommand("session.parent");
        }
    });
    return (_jsx(Box, { flexShrink: 0, children: _jsx(Box, { paddingTop: 1, paddingBottom: 1, paddingLeft: 2, paddingRight: 1, borderStyle: "single", borderColor: theme.border, flexShrink: 0, children: _jsxs(Box, { flexDirection: "row", justifyContent: "space-between", gap: 1, children: [_jsxs(Box, { flexDirection: "row", gap: 1, children: [_jsx(Text, { bold: true, color: theme.text, children: subagentInfo.label }), subagentInfo.total > 0 ? (_jsxs(Text, { dimColor: true, children: ["(", subagentInfo.index, " of ", subagentInfo.total, ")"] })) : null, usage ? (_jsx(Text, { dimColor: true, children: [usage.context, usage.cost].filter(Boolean).join(" . ") })) : null] }), _jsxs(Box, { flexDirection: "row", gap: 2, children: [_jsx(Box, { children: _jsxs(Text, { color: theme.text, children: ["Parent ", _jsx(Text, { dimColor: true, children: "p" })] }) }), _jsx(Box, { children: _jsxs(Text, { color: theme.text, children: ["Prev ", _jsx(Text, { dimColor: true, children: "[" })] }) }), _jsx(Box, { children: _jsxs(Text, { color: theme.text, children: ["Next ", _jsx(Text, { dimColor: true, children: "]" })] }) })] })] }) }) }));
}
