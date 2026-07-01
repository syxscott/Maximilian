import { jsx as _jsx } from "react/jsx-runtime";
/**
 * Aggregated context module for the Maximilian TUI.
 *
 * Re-exports React 19 ports of OpenCode's SolidJS contexts alongside minimal
 * stubs for contexts whose full ports haven't landed yet. Public API surface
 * (provider name + hook name + value shape) is preserved so the migration
 * stays mechanical — when a real port replaces a stub, only this file needs
 * editing.
 */
import React from "react";
export { ThemeProvider, useTheme, DEFAULT_THEMES } from "./theme";
export { SDKProvider, useSDK } from "./sdk";
export { TuiRuntimeProvider, useTuiPaths, useTuiTerminalEnvironment, useTuiStartup, } from "./runtime";
export { LocalProvider, useLocal } from "./local";
export { createSimpleContext } from "./helper";
// ---------------------------------------------------------------------------
// Stubs for contexts that haven't been ported yet.
//
// Each stub provides:
//   - `<X>Provider` whose `value` is a frozen default value
//   - `useX()` that returns the default value
//
// Consumers that need richer behaviour should replace the relevant stub with a
// real port (drop in a new module, re-export from this file).
// ---------------------------------------------------------------------------
export { useDialog, useToast } from "./_reexports";
function makeStubProvider(name, defaultValue) {
    const Ctx = React.createContext(undefined);
    function Provider({ children, value }) {
        const resolved = React.useMemo(() => Object.freeze({ ...defaultValue, ...value }), [value]);
        return React.createElement(Ctx.Provider, { value: resolved }, children);
    }
    function useStub() {
        const v = React.useContext(Ctx);
        if (v === undefined) {
            // Many stubs intentionally tolerate missing-provider because they're
            // wired in incrementally; returning the default keeps callers running.
            if (process.env.MAX_TUI_STRICT_CONTEXTS === "1") {
                throw new Error(`${name} context must be used within a ${name}Provider`);
            }
            return defaultValue;
        }
        return v;
    }
    return { Provider, use: useStub };
}
const { Provider: ClipboardProvider, use: useClipboardImpl } = makeStubProvider("Clipboard", {
    write: undefined,
});
export { ClipboardProvider, useClipboardImpl as useClipboard };
const { Provider: ArgsProvider, use: useArgs } = makeStubProvider("Args", {});
export { ArgsProvider, useArgs };
const kvImpl = {
    get(_key, fallback) {
        return fallback;
    },
    set() {
        /* no-op */
    },
};
const { Provider: KVProvider, use: useKV } = makeStubProvider("KV", kvImpl);
export { KVProvider, useKV };
const routeImpl = {
    data: { type: "home" },
    navigate() {
        /* no-op until RouteProvider is wired in */
    },
};
const { Provider: RouteProvider, use: useRoute } = makeStubProvider("Route", routeImpl);
export { RouteProvider, useRoute };
function ExitContextRoot({ children, onExit }) {
    const ctx = React.useMemo(() => ({
        exit: onExit ?? ((reason) => {
            if (reason !== undefined)
                console.error(reason);
            process.exit(0);
        }),
    }), [onExit]);
    return React.createElement(ExitContext.Provider, { value: ctx }, children);
}
const ExitContext = React.createContext(undefined);
export function ExitProvider(props) {
    return _jsx(ExitContextRoot, { ...props });
}
export function useExit() {
    const v = React.useContext(ExitContext);
    if (!v) {
        return {
            exit: (reason) => {
                if (reason !== undefined)
                    console.error(reason);
                process.exit(0);
            },
        };
    }
    return v;
}
function DefaultSlot(_props) {
    return null;
}
const pluginRuntimeImpl = {
    routes: new Map(),
    Slot: DefaultSlot,
};
const { Provider: PluginRuntimeProvider, use: usePluginRuntime } = makeStubProvider("PluginRuntime", pluginRuntimeImpl);
export { PluginRuntimeProvider, usePluginRuntime };
const { Provider: SyncProvider, use: useSync } = makeStubProvider("Sync", {
    status: "complete",
    data: {},
});
export { SyncProvider, useSync };
const { Provider: ProjectProvider, use: useProject } = makeStubProvider("Project", {
    workspace: {
        current: () => undefined,
        get: () => undefined,
    },
});
export { ProjectProvider, useProject };
const { Provider: EventProvider, use: useEvent } = makeStubProvider("Event", {
    on() {
        return () => { };
    },
    off() {
        /* no-op */
    },
});
export { EventProvider, useEvent };
// Default-arg shim so consumers can use a real TuiConfig value type.
export const TUI_CONFIG_DEFAULT = {
    mouse: true,
    keybinds: {
        gather() {
            return [];
        },
    },
};
// PromptRef / Editor are placeholders; consumers should cast as needed.
const { Provider: PromptRefProvider, use: usePromptRef } = makeStubProvider("PromptRef", { current: null });
export { PromptRefProvider, usePromptRef };
const { Provider: EditorContextProvider, use: useEditor } = makeStubProvider("Editor", {});
export { EditorContextProvider, useEditor };
// OpencodeKeymap is referenced by app.tsx for keybindings; stub it.
const { Provider: OpencodeKeymapProvider, use: useOpencodeKeymap } = makeStubProvider("OpencodeKeymap", {
    intercept: () => () => { },
    dispatchCommand: () => { },
});
export { OpencodeKeymapProvider, useOpencodeKeymap };
export function useBindings(_input) {
    /* bindings are wired through OpencodeKeymap; stub kept for compat */
}
export const OPENCODE_BASE_MODE = "base";
