/**
 * Event hook: typed subscription to the SDK global event stream.
 *
 * Ported from OpenCode's `context/event.ts`. The original filtered out
 * `sync` events and unwrapped `event.payload`; we mirror that on top of the
 * SDK context defined in `./sdk.tsx`.
 */
import { useSDK } from "./sdk";
export function useEvent() {
    const sdk = useSDK();
    function subscribe(handler) {
        return sdk.event.on("event", (event) => {
            if (event.type === "sync")
                return;
            handler({ type: event.type, properties: event.properties }, { directory: "", workspace: undefined });
        });
    }
    function on(type, handler) {
        return subscribe((event, metadata) => {
            if (event.type !== type)
                return;
            handler(event, metadata);
        });
    }
    return {
        subscribe,
        on,
    };
}
