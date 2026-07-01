/**
 * Stub for the home session destination provider.
 *
 * The OpenCode original implemented a small reactive store that remembers a
 * "destination" workspace/directory the user selected before any session
 * existed, so that newly-created sessions land there. We only need the
 * provider shape so consumers can compile; the real state plumbing is left
 * for a follow-up task.
 */
import { createContext, createElement, useContext, useState } from "react";
const SessionDestinationContext = createContext(undefined);
export function HomeSessionDestinationProvider(props) {
    const [destination, setDestinationState] = useState(undefined);
    const value = {
        destination: () => destination,
        setDestination: (next) => setDestinationState(next),
        clear: () => setDestinationState(undefined),
    };
    return createElement(SessionDestinationContext.Provider, { value }, props.children);
}
export function useHomeSessionDestination() {
    return useContext(SessionDestinationContext);
}
