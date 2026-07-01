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

import { useCallback, useEffect, useState } from "react"
import { createSimpleContext } from "./helper"
import { useSDK } from "./sdk"

type WorkspaceStatus = "connected" | "connecting" | "disconnected" | "error"

type Path = {
  home: string
  state: string
  config: string
  worktree: string
  directory: string
}

type Workspace = {
  id: string
  branch?: string
  type?: string
  [key: string]: unknown
}

type ProjectState = {
  project: {
    id?: string
    worktree?: string
    mainDir?: string
  }
  instance: {
    path: Path
  }
  workspace: {
    current?: string
    list: Workspace[]
    status: Record<string, WorkspaceStatus>
  }
}

type ProjectContextValue = {
  data: ProjectState
  project: () => string | undefined
  instance: {
    path: () => Path
    directory: () => string
  }
  workspace: {
    current: () => string | undefined
    set: (next?: string | null) => void
    list: () => Workspace[]
    get: (workspaceID: string) => Workspace | undefined
    status: (workspaceID: string) => WorkspaceStatus | undefined
    statuses: () => Record<string, WorkspaceStatus>
    sync: () => Promise<void>
  }
  sync: () => Promise<void>
}

export const { use: useProject, provider: ProjectProvider } = createSimpleContext<ProjectContextValue, Record<string, never>>({
  name: "Project",
  init: () => {
    const sdk = useSDK() as any

    const defaultPath: Path = {
      home: "",
      state: "",
      config: "",
      worktree: "",
      directory: sdk.directory ?? "",
    }

    const [project, setProject] = useState<ProjectState["project"]>({
      id: undefined,
      worktree: undefined,
      mainDir: undefined,
    })
    const [path_, setPath] = useState<Path>(defaultPath)
    const [workspaceCurrent, setWorkspaceCurrent] = useState<string | undefined>(undefined)
    const [workspaceList, setWorkspaceList] = useState<Workspace[]>([])
    const [workspaceStatus, setWorkspaceStatus] = useState<Record<string, WorkspaceStatus>>({})

    const data: ProjectState = {
      project,
      instance: { path: path_ },
      workspace: { current: workspaceCurrent, list: workspaceList, status: workspaceStatus },
    }

    const sync = useCallback(async () => {
      const workspace = workspaceCurrent
      const [instancePath, projectRes] = await Promise.all([
        sdk.client.path.get({ workspace }),
        sdk.client.project.current({ workspace }),
      ])
      const directories = projectRes.data?.id
        ? await sdk.client.project
            .directories({ projectID: projectRes.data.id, workspace })
            .catch(() => undefined)
        : undefined

      setPath(instancePath.data ?? defaultPath)
      setProject({
        id: projectRes.data?.id,
        worktree: projectRes.data?.worktree,
        mainDir: directories?.data?.findLast?.((item: { strategy?: string }) => item.strategy === undefined)
          ?.directory as string | undefined,
      })
    }, [sdk, workspaceCurrent])

    const syncWorkspace = useCallback(async () => {
      const listed = await sdk.client.experimental.workspace.list().catch(() => undefined)
      if (!listed?.data) return
      const status = await sdk.client.experimental.workspace.status().catch(() => undefined)
      const next = Object.fromEntries(
        (status?.data ?? []).map((item: { workspaceID: string; status: WorkspaceStatus }) => [
          item.workspaceID,
          item.status,
        ]),
      )
      setWorkspaceList(listed.data)
      setWorkspaceStatus(next)
      if (!listed.data.some((item: Workspace) => item.id === workspaceCurrent)) {
        setWorkspaceCurrent(undefined)
      }
    }, [sdk, workspaceCurrent])

    useEffect(() => {
      const handler = (event: any) => {
        if (event?.payload?.type === "workspace.status") {
          setWorkspaceStatus((prev) => ({
            ...prev,
            [event.payload.properties.workspaceID]: event.payload.properties.status,
          }))
        }
      }
      const unsub = sdk.event?.on?.("event", handler)
      return () => {
        if (typeof unsub === "function") unsub()
      }
    }, [sdk])

    return {
      data,
      project: () => project.id,
      instance: {
        path: () => path_,
        directory: () => path_.directory,
      },
      workspace: {
        current: () => workspaceCurrent,
        set: (next?: string | null) => {
          const workspace = next ?? undefined
          if (workspaceCurrent === workspace) return
          setWorkspaceCurrent(workspace)
        },
        list: () => workspaceList,
        get: (workspaceID: string) => workspaceList.find((item) => item.id === workspaceID),
        status: (workspaceID: string) => workspaceStatus[workspaceID],
        statuses: () => workspaceStatus,
        sync: syncWorkspace,
      },
      sync,
    }
  },
})
