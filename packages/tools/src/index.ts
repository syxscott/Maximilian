// Barrel export — @max/tools

export {
  createToolRegistry,
  type ToolRegistry,
  type Materialization,
  type Settlement,
  type ExecuteInput,
} from "./registry.js"
// Toolkit (借鉴 SuperAGI)
export { DefaultToolRegistry, BUILT_IN_TOOLKITS, type Tool, type Toolkit } from "./toolkit.js"
export { bashTool, type BashInput, type BashOutput } from "./bash.js"
// (borrowing) Mini-Agent background shell trio
export {
  bashOutputTool,
  bashKillTool,
  type BashOutputInput,
  type BashOutputResult,
  type BashKillInput,
  type BashKillResult,
} from "./bash-output.js"
export {
  BackgroundShellRegistry,
  getBackgroundShellRegistry,
  setBackgroundShellRegistry,
  type BackgroundShellRegistryOptions,
  type BackgroundShellSnapshot,
  type BackgroundShellStatus,
  type ReadResult,
} from "./bash-background.js"
export { readTool, type ReadInput, type ReadOutput } from "./read.js"
export { writeTool, type WriteInput, type WriteOutput } from "./write.js"
export { editTool, type EditInput, type EditOutput } from "./edit.js"
export { globTool, type GlobInput, type GlobOutput } from "./glob.js"
export { grepTool, type GrepInput, type GrepOutput } from "./grep.js"
export {
  withPermission,
  PermissionRequestError,
  PermissionDeniedError,
  isPermissionRequestError,
  isPermissionDeniedError,
  type PermissionProvider,
} from "./with-permission.js"
export {
  DEFAULT_PERMISSIONS,
  loadPermissions,
  savePermissions,
  type Permission,
  type Permissions,
  type ToolName,
} from "./permission.js"
export {
  PermissionService,
  type AlwaysDecision,
  type ApprovalResolution,
  type ApprovalEvent,
  type PendingRequest,
  type PermissionRequestInput,
  type PermissionServiceOptions,
} from "./permission-service.js"

import { bashTool } from "./bash.js"
import { bashOutputTool, bashKillTool } from "./bash-output.js"
import { readTool } from "./read.js"
import { writeTool } from "./write.js"
import { editTool } from "./edit.js"
import { globTool } from "./glob.js"
import { grepTool } from "./grep.js"
import type { AnyTool } from "@max/llm"

export const BUILTIN_TOOLS: Record<string, AnyTool> = {
  bash: bashTool,
  bash_output: bashOutputTool,
  bash_kill: bashKillTool,
  read: readTool,
  write: writeTool,
  edit: editTool,
  glob: globTool,
  grep: grepTool,
}
