import type { DAG } from "../dag/graph.js";
import type { PipelineNode, PipelineEdge } from "../types/pipeline.js";
import type { StateManager } from "./state-manager.js";

/**
 * Determines which pipeline nodes are ready to execute based on
 * the DAG structure and current execution state.
 */
export class Scheduler {
  constructor(
    private dag: DAG<PipelineNode, PipelineEdge>,
    private stateManager: StateManager,
  ) {}

  /**
   * Returns node IDs that are ready to run:
   * - Status is "pending"
   * - All predecessor nodes are complete (completed or skipped)
   */
  getReadyNodes(): string[] {
    const ready: string[] = [];

    for (const node of this.dag.getAllNodes()) {
      const state = this.stateManager.getNodeState(node.id);
      if (!state || state.status !== "pending") continue;

      const predecessors = this.dag.getPredecessors(node.id);
      const allDepsComplete = predecessors.every(pred =>
        this.stateManager.isNodeComplete(pred)
      );

      if (allDepsComplete) {
        ready.push(node.id);
      }
    }

    return ready;
  }

  /**
   * Returns the execution order as parallel groups.
   * Each group contains nodes that can execute concurrently.
   */
  getExecutionPlan(): string[][] {
    return this.dag.getParallelGroups();
  }

  /**
   * Checks if the pipeline execution is complete
   * (all nodes are in a terminal state).
   */
  isComplete(): boolean {
    return this.stateManager.areAllNodesTerminal();
  }

  /**
   * Resolves input mappings for a node by looking up outputs from predecessor nodes.
   * Supports expressions like:
   * - "nodes.step_id.outputs.field_name"
   * - "variables.var_name"
   * - literal values
   */
  resolveInputs(
    nodeId: string,
    variables: Record<string, unknown>,
  ): Record<string, unknown> {
    const node = this.dag.getNode(nodeId);
    if (!node) return {};

    const resolved: Record<string, unknown> = {};
    const mappings = node.data.inputMappings;

    for (const [paramName, expression] of Object.entries(mappings)) {
      resolved[paramName] = this.resolveExpression(expression, variables);
    }

    // Merge with static toolInput
    if (node.data.toolInput) {
      for (const [key, value] of Object.entries(node.data.toolInput)) {
        if (!(key in resolved)) {
          // Resolve template expressions in static inputs
          if (typeof value === "string" && value.includes("{{")) {
            resolved[key] = this.resolveTemplate(value, variables);
          } else {
            resolved[key] = value;
          }
        }
      }
    }

    return resolved;
  }

  private resolveExpression(
    expr: string,
    variables: Record<string, unknown>,
  ): unknown {
    // nodes.step_id.outputs.field_name
    if (expr.startsWith("nodes.")) {
      const parts = expr.split(".");
      if (parts.length >= 4 && parts[2] === "outputs") {
        const nodeId = parts[1];
        const field = parts.slice(3).join(".");
        const nodeState = this.stateManager.getNodeState(nodeId);
        return nodeState?.outputs[field];
      }
    }

    // variables.var_name
    if (expr.startsWith("variables.")) {
      const varName = expr.slice("variables.".length);
      return variables[varName];
    }

    // Template string
    if (expr.includes("{{")) {
      return this.resolveTemplate(expr, variables);
    }

    // Literal
    return expr;
  }

  private resolveTemplate(
    template: string,
    variables: Record<string, unknown>,
  ): string {
    return template.replace(/\{\{\s*(\w+(?:\.\w+)*)\s*\}\}/g, (_, path: string) => {
      if (path.startsWith("variables.")) {
        path = path.slice("variables.".length);
      }
      const value = variables[path];
      return value !== undefined ? String(value) : `{{ ${path} }}`;
    });
  }
}
