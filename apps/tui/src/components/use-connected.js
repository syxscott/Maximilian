import { useSync } from "../context/sync";
/**
 * Returns whether the user has at least one provider that is connected
 * (or that has any non-zero-cost model). Mirrors the OpenCode behavior:
 * "opencode" provider counts as connected when it has any model with
 * non-zero input cost. Other providers count as connected if present.
 */
export function useConnected() {
    const sync = useSync();
    return sync.data.provider.some((provider) => provider.id !== "opencode" ||
        Object.values(provider.models).some((model) => model.cost?.input !== 0));
}
