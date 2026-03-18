import type {
  PipelineExecutionState,
  NodeExecutionState,
  NodeExecutionStatus,
  PipelineStatus,
} from "../types/execution.js";
import { generateExecutionId } from "../utils/id.js";

/**
 * Manages pipeline execution state — tracks which nodes are pending,
 * running, completed, or failed.
 */
export class StateManager {
  private state: PipelineExecutionState;

  constructor(pipelineId: string, nodeIds: string[]) {
    const nodes = new Map<string, NodeExecutionState>();
    for (const nodeId of nodeIds) {
      nodes.set(nodeId, {
        nodeId,
        status: "pending",
        inputs: {},
        outputs: {},
        attempts: 0,
      });
    }

    this.state = {
      executionId: generateExecutionId(),
      pipelineId,
      status: "pending",
      startedAt: Date.now(),
      nodes,
      variables: {},
    };
  }

  // ── Pipeline-level state ────────────────────────────────────────

  getState(): PipelineExecutionState {
    return this.state;
  }

  get executionId(): string {
    return this.state.executionId;
  }

  get pipelineStatus(): PipelineStatus {
    return this.state.status;
  }

  setPipelineStatus(status: PipelineStatus): void {
    this.state.status = status;
    if (status === "completed" || status === "failed" || status === "cancelled") {
      this.state.completedAt = Date.now();
    }
  }

  setVariable(name: string, value: unknown): void {
    this.state.variables[name] = value;
  }

  getVariable(name: string): unknown {
    return this.state.variables[name];
  }

  // ── Node-level state ────────────────────────────────────────────

  getNodeState(nodeId: string): NodeExecutionState | undefined {
    return this.state.nodes.get(nodeId);
  }

  setNodeStatus(nodeId: string, status: NodeExecutionStatus): void {
    const node = this.state.nodes.get(nodeId);
    if (!node) return;

    node.status = status;
    if (status === "running") {
      node.startedAt = Date.now();
      node.attempts++;
    }
    if (status === "completed" || status === "failed" || status === "skipped") {
      node.completedAt = Date.now();
    }
  }

  setNodeOutputs(nodeId: string, outputs: Record<string, unknown>): void {
    const node = this.state.nodes.get(nodeId);
    if (node) node.outputs = outputs;
  }

  setNodeInputs(nodeId: string, inputs: Record<string, unknown>): void {
    const node = this.state.nodes.get(nodeId);
    if (node) node.inputs = inputs;
  }

  setNodeError(nodeId: string, error: string): void {
    const node = this.state.nodes.get(nodeId);
    if (node) node.error = error;
  }

  // ── Query helpers ───────────────────────────────────────────────

  getNodesByStatus(status: NodeExecutionStatus): string[] {
    return [...this.state.nodes.entries()]
      .filter(([, state]) => state.status === status)
      .map(([id]) => id);
  }

  isNodeComplete(nodeId: string): boolean {
    const state = this.state.nodes.get(nodeId);
    return state?.status === "completed" || state?.status === "skipped";
  }

  areAllNodesTerminal(): boolean {
    return [...this.state.nodes.values()].every(
      n => n.status === "completed" || n.status === "failed" || n.status === "skipped"
    );
  }

  hasFailedNodes(): boolean {
    return [...this.state.nodes.values()].some(n => n.status === "failed");
  }

  // ── Serialization ───────────────────────────────────────────────

  toJSON(): Record<string, unknown> {
    return {
      ...this.state,
      nodes: Object.fromEntries(this.state.nodes),
    };
  }

  static fromJSON(data: Record<string, unknown>): StateManager {
    const manager = Object.create(StateManager.prototype) as StateManager;
    const nodes = data.nodes as Record<string, NodeExecutionState>;
    manager.state = {
      ...data as unknown as PipelineExecutionState,
      nodes: new Map(Object.entries(nodes)),
    };
    return manager;
  }
}
