/**
 * Project + workspace context. Tracks the current project, the active
 * workspace, and the set of known workspaces (with their connection status).
 *
 * Ported from OpenCode's SolidJS `project.tsx`. Solid used a `createStore`
 * plus `reconcile` diffs to keep mutations cheap. We approximate that with a
 * React reducer-like state: each setter produces a new object so consumers
 * re-render correctly. The reactive `batch()` boundary is replaced by
 * multiple sequential `setState` calls inside the same async function —
 * React 18+ automatically batches those inside event handlers, and async
 * callbacks do too as of React 19.
 */
import { useCallback, useEffect, useState } from "react";
import { createSimpleContext } from "./helper";
import { useSDK } from "./sdk";
export const { use: useProject, provider: ProjectProvider } = createSimpleContext({
    name: "Project",
    init: () => {
        const sdk = useSDK();
        const defaultPath = {
            home: "",
            state: "",
            config: "",
            worktree: "",
            directory: sdk.directory ?? "",
        };
        const [project, setProject] = useState({
            id: undefined,
            worktree: undefined,
            mainDir: undefined,
        });
        const [path_, setPath] = useState(defaultPath);
        const [workspaceCurrent, setWorkspaceCurrent] = useState(undefined);
        const [workspaceList, setWorkspaceList] = useState([]);
        const [workspaceStatus, setWorkspaceStatus] = useState({});
        const data = {
            project,
            instance: { path: path_ },
            workspace: { current: workspaceCurrent, list: workspaceList, status: workspaceStatus },
        };
        const sync = useCallback(async () => {
            const workspace = workspaceCurrent;
            const [instancePath, projectRes] = await Promise.all([
                sdk.client.path.get({ workspace }),
                sdk.client.project.current({ workspace }),
            ]);
            const directories = projectRes.data?.id
                ? await sdk.client.project
                    .directories({ projectID: projectRes.data.id, workspace })
                    .catch(() => undefined)
                : undefined;
            setPath(instancePath.data ?? defaultPath);
            setProject({
                id: projectRes.data?.id,
                worktree: projectRes.data?.worktree,
                mainDir: directories?.data?.findLast?.((item) => item.strategy === undefined)
                    ?.directory,
            });
        }, [sdk, workspaceCurrent]);
        const syncWorkspace = useCallback(async () => {
            const listed = await sdk.client.experimental.workspace.list().catch(() => undefined);
            if (!listed?.data)
                return;
            const status = await sdk.client.experimental.workspace.status().catch(() => undefined);
            const next = Object.fromEntries((status?.data ?? []).map((item) => [
                item.workspaceID,
                item.status,
            ]));
            setWorkspaceList(listed.data);
            setWorkspaceStatus(next);
            if (!listed.data.some((item) => item.id === workspaceCurrent)) {
                setWorkspaceCurrent(undefined);
            }
        }, [sdk, workspaceCurrent]);
        useEffect(() => {
            const handler = (event) => {
                if (event?.payload?.type === "workspace.status") {
                    setWorkspaceStatus((prev) => ({
                        ...prev,
                        [event.payload.properties.workspaceID]: event.payload.properties.status,
                    }));
                }
            };
            const unsub = sdk.event?.on?.("event", handler);
            return () => {
                if (typeof unsub === "function")
                    unsub();
            };
        }, [sdk]);
        return {
            data,
            project: () => project.id,
            instance: {
                path: () => path_,
                directory: () => path_.directory,
            },
            workspace: {
                current: () => workspaceCurrent,
                set: (next) => {
                    const workspace = next ?? undefined;
                    if (workspaceCurrent === workspace)
                        return;
                    setWorkspaceCurrent(workspace);
                },
                list: () => workspaceList,
                get: (workspaceID) => workspaceList.find((item) => item.id === workspaceID),
                status: (workspaceID) => workspaceStatus[workspaceID],
                statuses: () => workspaceStatus,
                sync: syncWorkspace,
            },
            sync,
        };
    },
});
