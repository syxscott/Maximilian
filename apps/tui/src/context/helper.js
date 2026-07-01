/**
 * Simple React 19 context factory for the Maximilian TUI.
 *
 * Replaces OpenCode's SolidJS `createSimpleContext` helper. The Solid version
 * used a `Show` wrapper to gate provider mounting until `init.ready === true`;
 * in React we model that explicitly via an optional `ready` flag that
 * providers check in `useXxx` hooks, since React does not allow conditional
 * provider mounting without violating the rules of hooks.
 *
 * The init function is called directly in the component body (not inside useMemo)
 * to comply with Rules of Hooks — init functions may call React hooks internally.
 */
import { createContext, createElement, useContext } from "react";
export function createSimpleContext(input) {
    const Ctx = createContext(undefined);
    function ProviderInner(props) {
        const { children, ...rest } = props;
        // Call init directly (not in useMemo) so hooks inside init are called every render
        const value = input.init(rest);
        return createElement(Ctx.Provider, { value }, children);
    }
    const handle = {
        context: Ctx,
        provider: ((props) => createElement(ProviderInner, props)),
        use() {
            const value = useContext(Ctx);
            if (value === undefined) {
                throw new Error(`${input.name} context must be used within a context provider`);
            }
            return value;
        },
    };
    return handle;
}
