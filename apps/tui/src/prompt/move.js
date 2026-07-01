/**
 * Move-session hook.
 *
 * Ported from OpenCode's `prompt/move.tsx`. The original wrapped SDK calls to
 * create a workspace copy and move an existing session into a different
 * directory. Maximilian doesn't ship those SDK endpoints yet, so the hook
 * preserves the public surface but turns the create/move actions into
 * console.warn stubs. Real wiring can drop in by replacing `create` and
 * `moveExistingSession` with actual SDK invocations.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useSDK } from "../context/sdk";
import { useSync } from "../context/sync";
export function usePromptMove(input) {
    const sdk = useSDK();
    const sync = useSync();
    void sync;
    const [creating, setCreating] = useState(false);
    const [progress, setProgress] = useState(undefined);
    const projectIDRef = useRef(undefined);
    useEffect(() => {
        projectIDRef.current = input.projectID();
    }, [input]);
    const create = useCallback(async (_context) => {
        const projectID = projectIDRef.current;
        if (!projectID)
            return undefined;
        setCreating(true);
        setProgress("Creating copy");
        try {
            // TODO: call `sdk.client.post('/project/copy', { projectID, ... })`
            // once that endpoint exists in Maximilian's backend.
            const directory = `/tmp/max-worktree/${projectID.slice(0, 6)}`;
            setProgress("Creating session");
            return directory;
        }
        catch (err) {
            console.error("[move] creating workspace failed", err);
            setProgress(undefined);
            setCreating(false);
            return undefined;
        }
    }, [sdk]);
    const open = useCallback(() => {
        // In OpenCode this opens `DialogMoveSession`; in Maximilian it's a stub.
        console.log("[move] open dialog (stub)");
    }, []);
    const moveExistingSession = useCallback(async (sessionID, _selection) => {
        const session = sync.data.session.find((s) => s.id === sessionID);
        void session;
        setProgress("Moving session");
        try {
            // TODO: call `sdk.client.post('/session/move', { sessionID, ... })`
            // when the endpoint lands.
            console.log("[move] move session", sessionID);
        }
        finally {
            setProgress(undefined);
            setCreating(false);
        }
    }, [sdk, sync]);
    const getDirectory = useCallback(async (_context) => {
        // The "pending destination" state lives on `useHomeSessionDestination`
        // in the OpenCode version; here we just return undefined so the prompt
        // falls back to the current cwd.
        return undefined;
    }, []);
    const startSubmit = useCallback(() => {
        if (progress)
            setProgress("Submitting prompt");
    }, [progress]);
    const finishSubmit = useCallback(() => {
        setProgress(undefined);
        setCreating(false);
    }, []);
    return {
        creating: () => creating,
        progress: () => progress,
        open,
        getDirectory,
        startSubmit,
        finishSubmit,
        moveExistingSession,
        pending: () => false,
        pendingNew: () => false,
        create,
    };
}
