/**
 * TUI runtime context: paths, terminal environment, and startup flags.
 *
 * Ported from OpenCode's SolidJS `runtime.tsx`. Solid used individual context
 * providers via `createContext`; React 19 lets us co-locate these three small
 * providers into a single shape with three `useXxx()` hooks for symmetry.
 */
import { createContext, createElement, useContext } from "react";
const RuntimeContext = createContext(undefined);
export function TuiRuntimeProvider(props) {
    const value = Object.freeze({ ...props.value });
    return createElement(RuntimeContext.Provider, { value }, props.children);
}
function require(name, ctx) {
    const value = useContext(ctx);
    if (!value)
        throw new Error(`${name} is missing`);
    return value;
}
export function useTuiPaths() {
    return require("TuiPathsProvider", RuntimeContext).paths;
}
export function useTuiTerminalEnvironment() {
    return require("TuiTerminalEnvironmentProvider", RuntimeContext).env;
}
export function useTuiStartup() {
    return require("TuiStartupProvider", RuntimeContext).startup;
}
