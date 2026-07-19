/**
 * Immutable TaskNode with validated state-transition table (borrowed from
 * sentient-agi/ROMA `src/roma_dspy/core/signatures/base_models/task_node.py:144-191`
 * + `src/roma_dspy/types/task_status.py:78-116`).
 *
 * Background: ROMA's central abstraction is an immutable Task node moving
 * through a validated status machine inside a nested DAG. Key ideas:
 *   - All mutations return NEW instances (copy-on-write) — the original is
 *     never mutated. This gives thread/process safety for free under
 *     parallel sibling execution.
 *   - Every state transition goes through a `canTransitionTo` table that
 *     throws on illegal moves. The table is the single source of truth
 *     for "what state can follow what".
 *   - The `state_transitions` array is an auditable history, so the engine
 *     can log "this task has been PLANNING 3 times; it's stuck" and trigger
 *     a replan or forced-execute.
 *
 * Maximilian's adaptation:
 *   - Kept the state machine identical to ROMA's so cross-referencing
 *     research stays easy.
 *   - Renamed a few fields to match Maximilian's `Phase*` vocabulary
 *     (Phase → TaskNode, gate → verdict, etc.) while preserving the ROMA
 *     state names (`PENDING → ATOMIZING → PLANNING | EXECUTING → …`).
 *   - Added `dependsOn: string[]` so the DAG builder (see atomizer.ts)
 *     can construct the index-based dependency graph that ROMA's planner
 *     emits (`{ "1": ["0"], "2": ["0","1"] }`).
 *
 * Types are plain TS (no Zod) to keep the hot-path allocation-free; the
 * state machine is leaf code that runs on every task step.
 */

// ── Task status enum (mirrors ROMA's `types/task_status.py:78-116`) ───────

export enum TaskStatus {
  PENDING = "pending",
  ATOMIZING = "atomizing",      // deciding: decompose or execute directly
  PLANNING = "planning",        // decomposing into sub-tasks
  PLAN_DONE = "plan_done",      // plan produced, ready to aggregate/execute
  EXECUTING = "executing",      // running the task itself
  AGGREGATING = "aggregating",  // waiting for sub-tasks to complete
  COMPLETED = "completed",
  FAILED = "failed",
  NEEDS_REPLAN = "needs_replan", // (declared but not wired, per ROMA)
}

/** Phases of the meta-agent loop; maps 1:1 to ROMA's transitions. */
export type TaskStatusValue = `${TaskStatus}`;

// ── Status-transition table ─────────────────────────────────────────────────

const TRANSITION_TABLE: Record<TaskStatus, ReadonlyArray<TaskStatus>> = {
  [TaskStatus.PENDING]: [TaskStatus.ATOMIZING],
  [TaskStatus.ATOMIZING]: [TaskStatus.PLANNING, TaskStatus.EXECUTING],
  [TaskStatus.PLANNING]: [TaskStatus.PLAN_DONE, TaskStatus.FAILED],
  [TaskStatus.PLAN_DONE]: [TaskStatus.AGGREGATING, TaskStatus.COMPLETED],
  [TaskStatus.EXECUTING]: [TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.AGGREGATING, TaskStatus.NEEDS_REPLAN],
  [TaskStatus.AGGREGATING]: [TaskStatus.COMPLETED, TaskStatus.FAILED],
  [TaskStatus.NEEDS_REPLAN]: [TaskStatus.PLANNING, TaskStatus.FAILED],
  [TaskStatus.COMPLETED]: [],
  [TaskStatus.FAILED]: [],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITION_TABLE[from]?.includes(to) ?? false;
}

export function terminalStates(): ReadonlyArray<TaskStatus> {
  return [TaskStatus.COMPLETED, TaskStatus.FAILED];
}

export function isTerminal(s: TaskStatus): boolean {
  return terminalStates().includes(s);
}

// ── Node type (PLAN tasks spawn sub-graphs; EXECUTE tasks run directly) ────

export enum NodeType {
  PLAN = "plan",
  EXECUTE = "execute",
}

export enum TaskType {
  STRATEGY = "strategy",
  RETRIEVE = "retrieve",
  REASONING = "reasoning",
  IMAGE_GENERATION = "image_generation",
  CODE_GENERATION = "code_generation",
  VERIFICATION = "verification",
}

// ── State transition record (auditable history) ───────────────────────────

export interface StateTransition {
  from: TaskStatus;
  to: TaskStatus;
  at: string; // ISO timestamp
  reason?: string;
}

// ── Immutable TaskNode ────────────────────────────────────────────────────

export interface TaskNodeOptions {
  id: string;
  description: string;
  nodeType?: NodeType;
  taskType?: TaskType;
  status?: TaskStatus;
  depth?: number;
  maxDepth?: number;
  dependsOn?: ReadonlyArray<string>;
  input?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  stateTransitions?: ReadonlyArray<StateTransition>;
  children?: ReadonlyArray<string>;
  metadata?: Record<string, unknown>;
}

export interface TaskNode {
  readonly id: string;
  readonly description: string;
  readonly nodeType: NodeType;
  readonly taskType: TaskType;
  readonly status: TaskStatus;
  readonly depth: number;
  readonly maxDepth: number;
  readonly dependsOn: ReadonlyArray<string>;
  readonly input: Readonly<Record<string, unknown>>;
  readonly result: unknown;
  readonly error: string | undefined;
  readonly stateTransitions: ReadonlyArray<StateTransition>;
  readonly children: ReadonlyArray<string>;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export class TaskNodeImpl implements TaskNode {
  readonly id: string;
  readonly description: string;
  readonly nodeType: NodeType;
  readonly taskType: TaskType;
  readonly status: TaskStatus;
  readonly depth: number;
  readonly maxDepth: number;
  readonly dependsOn: ReadonlyArray<string>;
  readonly input: Readonly<Record<string, unknown>>;
  readonly result: unknown;
  readonly error: string | undefined;
  readonly stateTransitions: ReadonlyArray<StateTransition>;
  readonly children: ReadonlyArray<string>;
  readonly metadata: Readonly<Record<string, unknown>>;

  constructor(opts: TaskNodeOptions) {
    this.id = opts.id;
    this.description = opts.description;
    this.nodeType = opts.nodeType ?? NodeType.EXECUTE;
    this.taskType = opts.taskType ?? TaskType.STRATEGY;
    this.status = opts.status ?? TaskStatus.PENDING;
    this.depth = opts.depth ?? 0;
    this.maxDepth = opts.maxDepth ?? 2;
    this.dependsOn = opts.dependsOn ?? [];
    this.input = opts.input ?? {};
    this.result = opts.result;
    this.error = opts.error;
    this.stateTransitions = opts.stateTransitions ?? [];
    this.children = opts.children ?? [];
    this.metadata = opts.metadata ?? {};
  }
}

/** Create a fresh PENDING node. */
export function createTaskNode(opts: Omit<TaskNodeOptions, "status">): TaskNodeImpl {
  return new TaskNodeImpl({ ...opts, status: TaskStatus.PENDING });
}

/** ROMA `should_force_execute()` — depth-based termination guard. */
export function shouldForceExecute(node: TaskNode): boolean {
  return node.depth >= node.maxDepth;
}

/**
 * Validate + apply a state transition. Returns a NEW node; the original
 * is never mutated. Throws `IllegalTransitionError` on illegal moves.
 *
 * Mirrors ROMA's `transition_to` at `task_node.py:158-162`.
 */
export function transition(
  node: TaskNode,
  to: TaskStatus,
  reason?: string,
): TaskNodeImpl {
  if (!canTransition(node.status, to)) {
    const legal = TRANSITION_TABLE[node.status] ?? [];
    throw new IllegalTransitionError(node.id, node.status, to, legal);
  }
  const stamp = new Date().toISOString();
  const transitionRecord: StateTransition = { from: node.status, to, at: stamp, ...(reason ? { reason } : {}) };
  return new TaskNodeImpl({
    ...node,
    status: to,
    stateTransitions: [...node.stateTransitions, transitionRecord],
  });
}

/** Apply a result to a node (immutable). Returns a new node. */
export function withResult(node: TaskNode, result: unknown): TaskNodeImpl {
  return new TaskNodeImpl({ ...node, result });
}

/** Apply an error to a node (immutable). Returns a new node. */
export function withError(node: TaskNode, error: string): TaskNodeImpl {
  return new TaskNodeImpl({ ...node, error });
}

/** Add a child to a PLAN node (immutable). Returns a new node. */
export function withChild(node: TaskNode, childId: string): TaskNodeImpl {
  if (node.nodeType !== NodeType.PLAN) {
    throw new IllegalTransitionError(node.id, node.status, node.status, [], "only PLAN nodes can have children");
  }
  if (node.children.includes(childId)) return node as TaskNodeImpl;
  return new TaskNodeImpl({ ...node, children: [...node.children, childId] });
}

/** Add a dependency (immutable). Returns a new node. */
export function withDependency(node: TaskNode, dependsOn: string): TaskNodeImpl {
  if (node.dependsOn.includes(dependsOn)) return node as TaskNodeImpl;
  return new TaskNodeImpl({ ...node, dependsOn: [...node.dependsOn, dependsOn] });
}

// ── Error for illegal transitions ─────────────────────────────────────────

export class IllegalTransitionError extends Error {
  readonly taskId: string;
  readonly from: TaskStatus;
  readonly to: TaskStatus;
  readonly legalTargets: ReadonlyArray<TaskStatus>;
  constructor(
    taskId: string,
    from: TaskStatus,
    to: TaskStatus,
    legalTargets: ReadonlyArray<TaskStatus>,
    hint?: string,
  ) {
    super(
      `Illegal task transition for "${taskId}": ${from} → ${to}. ` +
        `Legal targets from ${from}: [${legalTargets.join(", ") ?? "none"}]. ` +
        (hint ?? ""),
    );
    this.name = "IllegalTransitionError";
    this.taskId = taskId;
    this.from = from;
    this.to = to;
    this.legalTargets = legalTargets;
  }
}
