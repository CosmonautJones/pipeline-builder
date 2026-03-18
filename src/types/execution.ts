// ── Node Execution Status ───────────────────────────────────────────

export type NodeExecutionStatus =
  | "pending"
  | "ready"           // all dependencies met, can run
  | "running"
  | "waiting-human"   // paused at human-review node
  | "completed"
  | "failed"
  | "skipped";        // condition evaluated false

// ── Pipeline Status ─────────────────────────────────────────────────

export type PipelineStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

// ── Node Execution State ────────────────────────────────────────────

export interface NodeExecutionState {
  nodeId: string;
  status: NodeExecutionStatus;
  startedAt?: number;
  completedAt?: number;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  error?: string;
  attempts: number;
}

// ── Pipeline Execution State ────────────────────────────────────────

export interface PipelineExecutionState {
  executionId: string;
  pipelineId: string;
  status: PipelineStatus;
  startedAt: number;
  completedAt?: number;
  nodes: Map<string, NodeExecutionState>;
  variables: Record<string, unknown>;
}

// ── Execution Events ────────────────────────────────────────────────

export interface ExecutionEvent {
  type:
    | "node-started"
    | "node-completed"
    | "node-failed"
    | "node-skipped"
    | "pipeline-started"
    | "pipeline-completed"
    | "pipeline-failed"
    | "human-review-needed"
    | "checkpoint-saved";
  executionId: string;
  nodeId?: string;
  data?: unknown;
  timestamp: number;
}

// ── Execution Options ───────────────────────────────────────────────

export interface ExecutionOptions {
  dryRun?: boolean;
  variables?: Record<string, unknown>;
  secrets?: Record<string, string>;
  concurrency?: number;
  onStepStart?: (nodeId: string) => void;
  onStepComplete?: (nodeId: string, outputs: Record<string, unknown>) => void;
  onStepFailed?: (nodeId: string, error: string) => void;
  onHumanReview?: (nodeId: string, prompt: string) => Promise<boolean>;
  onLog?: (level: string, message: string, meta?: Record<string, unknown>) => void;
}
