export function createPluginRoutes() {
    const routes = new Map();
    // React consumers re-render when the routes identity changes; we use a
    // version counter wrapped in a state holder so callers can subscribe to
    // route registrations/deregistrations the same way the Solid version did.
    let revision = 0;
    const revisionState = {
        get current() {
            return revision;
        },
    };
    const setRevision = (value) => {
        revision = typeof value === "function" ? value(revision) : value;
        revisionState.current = revision;
    };
    return {
        revision: revisionState,
        register(list) {
            const key = Symbol();
            list.forEach((item) => routes.set(item.name, [...(routes.get(item.name) ?? []), { key, render: item.render }]));
            setRevision((value) => value + 1);
            return () => {
                list.forEach((item) => {
                    const next = routes.get(item.name)?.filter((entry) => entry.key !== key) ?? [];
                    if (next.length) {
                        routes.set(item.name, next);
                        return;
                    }
                    routes.delete(item.name);
                });
                setRevision((value) => value + 1);
            };
        },
        get(name) {
            return routes.get(name)?.at(-1)?.render;
        },
    };
}
export function createTuiApi(input) {
    return {
        ...input,
        lifecycle: {
            signal: new AbortController().signal,
            onDispose() {
                return () => { };
            },
        },
    };
}
