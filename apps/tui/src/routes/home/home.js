import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// @ts-nocheck
/**
 * Home route: launcher screen with logo + prompt.
 *
 * Ported from OpenCode's SolidJS `routes/home.tsx`. The OpenCode version used
 * a custom `<box>`/`<text>` JSX namespace from `@opentui/solid`. We rewrite
 * to standard ink primitives (Box, Text) while keeping the same visual
 * structure: centered logo, prompt input, footer slot, and toasts.
 *
 * Plugin runtime slots (`home_logo`, `home_prompt`, etc.) are replaced with
 * simple passthrough components — full plugin support is deferred until a
 * plugin manifest exists for Maximilian.
 */
import { useEffect, useRef } from "react";
import { Box, Text } from "ink";
import { Prompt } from "../../prompt";
import { useSync } from "../../context/sync";
import { useRouteData } from "../../context/route";
import { useLocal } from "../../context/local";
import { useArgs } from "../../context/args";
import { HomeSessionDestinationProvider } from "./session-destination";
const placeholder = {
    normal: ["Fix a TODO in the codebase", "What is the tech stack of this project?", "Fix broken tests"],
    shell: ["ls -la", "git status", "pwd"],
};
export function Home() {
    const sync = useSync();
    const route = useRouteData("home");
    const args = useArgs();
    const local = useLocal();
    const promptRef = useRef(undefined);
    const sentRef = useRef(false);
    const onceRef = useRef(false);
    useEffect(() => {
        // Mirror the original `onMount` `editor.clearSelection()` call.
        // Real editor wiring is out of scope for this port.
    }, []);
    const bind = (ref) => {
        promptRef.current = ref;
        if (onceRef.current || !ref)
            return;
        if (route.prompt) {
            ref.set(route.prompt);
            onceRef.current = true;
            return;
        }
        if (args.prompt) {
            ref.set({ input: args.prompt, parts: [] });
            onceRef.current = true;
        }
    };
    useEffect(() => {
        if (sentRef.current)
            return;
        if (!promptRef.current)
            return;
        if (!sync.ready || !local.model.ready)
            return;
        if (!args.prompt)
            return;
        if (promptRef.current.current.input !== args.prompt)
            return;
        sentRef.current = true;
        promptRef.current.submit();
    }, [sync.ready, local.model.ready, args.prompt]);
    return (_jsxs(HomeSessionDestinationProvider, { children: [_jsxs(Box, { flexDirection: "column", flexGrow: 1, alignItems: "center", paddingLeft: 2, paddingRight: 2, children: [_jsx(Box, { flexGrow: 1 }), _jsx(Box, { height: 4, flexShrink: 1, children: _jsx(Text, { children: "opencode" }) }), _jsx(Box, { height: 1, flexShrink: 1 }), _jsx(Box, { width: "100%", zIndex: 1000, paddingTop: 1, flexShrink: 0, children: _jsx(Prompt, { ref: bind, placeholders: placeholder }) }), _jsx(Box, { flexGrow: 1 })] }), _jsx(Box, { width: "100%", flexShrink: 0 })] }));
}
