import type { PipelineDefinition } from "../types/pipeline.js";
import type { PipelineExecutionState, ExecutionOptions, ExecutionEvent } from "../types/execution.js";
import { buildDAGFromPipeline, validatePipelineDAG } from "../dag/index.js";
import { StateManager } from "./state-manager.js";
import { Scheduler } from "./scheduler.js";
import { TypedEventBus } from "../utils/event-bus.js";
import { createChildLogger } from "../utils/logger.js";
import { StepExecutionError, PipelineTimeoutError, DAGValidationError } from "../utils/errors.js";

export interface StepHandler {
  (nodeId: string, inputs: Record<string, unknown>): Promise<Record<string, unknown>>;
}

/**
 * Pipeline execution runtime.
 * Takes a PipelineDefinition and executes it according to the DAG.
 */
export class PipelineRuntime {
  private logger = createChildLogger("PipelineRuntime");
  private eventBus = new TypedEventBus();
  private stepHandler?: StepHandler;
  private abortController?: AbortController;

  /**
   * Register a handler that executes individual pipeline steps.
   * This is the integration point for MCP tools, shell commands, etc.
   */
  onStep(handler: StepHandler): void {
    this.stepHandler = handler;
  }

  /**
   * Subscribe to execution events.
   */
  on(event: "execution", listener: (data: ExecutionEvent) => void): void {
    this.eventBus.on("execution", listener);
  }

  /**
   * Execute a pipeline definition.
   */
  async execute(
    pipeline: PipelineDefinition,
    options?: ExecutionOptions,
  ): Promise<PipelineExecutionState> {
    // Build and validate DAG
    const dag = buildDAGFromPipeline(pipeline);
    const validation = validatePipelineDAG(dag, pipeline);
    if (!validation.valid) {
      throw new DAGValidationError(
        `Pipeline validation failed: ${validation.errors.join("; ")}`
      );
    }

    // Initialize state
    const nodeIds = pipeline.nodes.map(n => n.id);
    const stateManager = new StateManager(pipeline.metadata.name, nodeIds);
    const scheduler = new Scheduler(dag, stateManager);

    // Merge variables
    const variables: Record<string, unknown> = { ...options?.variables };
    for (const v of pipeline.variables) {
      if (!(v.name in variables) && v.default !== undefined) {
        variables[v.name] = v.default;
      }
    }
    for (const [k, v] of Object.entries(variables)) {
      stateManager.setVariable(k, v);
    }

    // Start execution
    stateManager.setPipelineStatus("running");
    this.emitEvent(stateManager.executionId, "pipeline-started");

    // Set up timeout
    this.abortController = new AbortController();
    const timeoutMs = pipeline.timeoutPolicy?.pipelineTimeoutMs;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs) {
      timeoutId = setTimeout(() => this.abortController?.abort(), timeoutMs);
    }

    const concurrency = options?.concurrency ?? 5;

    try {
      // Main execution loop
      while (!scheduler.isComplete()) {
        if (this.abortController.signal.aborted) {
          throw new PipelineTimeoutError(stateManager.executionId, timeoutMs ?? 0);
        }

        const readyNodes = scheduler.getReadyNodes();
        if (readyNodes.length === 0) {
          // No nodes ready and not complete — deadlock or waiting for human
          const waiting = stateManager.getNodesByStatus("waiting-human");
          if (waiting.length > 0) {
            // Wait for human approval
            await this.handleHumanReview(waiting, pipeline, stateManager, options);
            continue;
          }
          // True deadlock
          this.logger.error("Execution deadlocked — no runnable nodes");
          break;
        }

        // Execute ready nodes in parallel (up to concurrency limit)
        const batch = readyNodes.slice(0, concurrency);
        await Promise.all(
          batch.map(nodeId =>
            this.executeNode(nodeId, pipeline, stateManager, scheduler, variables, options)
          )
        );
      }

      // Determine final status
      if (stateManager.hasFailedNodes()) {
        stateManager.setPipelineStatus("failed");
        this.emitEvent(stateManager.executionId, "pipeline-failed");
      } else {
        stateManager.setPipelineStatus("completed");
        this.emitEvent(stateManager.executionId, "pipeline-completed");
      }
    } catch (error) {
      stateManager.setPipelineStatus("failed");
      this.emitEvent(stateManager.executionId, "pipeline-failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }

    return stateManager.getState();
  }

  /**
   * Cancel a running execution.
   */
  cancel(): void {
    this.abortController?.abort();
  }

  // ── Private ─────────────────────────────────────────────────────

  private async executeNode(
    nodeId: string,
    pipeline: PipelineDefinition,
    stateManager: StateManager,
    scheduler: Scheduler,
    variables: Record<string, unknown>,
    options?: ExecutionOptions,
  ): Promise<void> {
    const node = pipeline.nodes.find(n => n.id === nodeId);
    if (!node) return;

    // Handle condition nodes
    if (node.type === "condition" && node.condition) {
      const shouldRun = this.evaluateCondition(node.condition, variables);
      if (!shouldRun) {
        stateManager.setNodeStatus(nodeId, "skipped");
        this.emitEvent(stateManager.executionId, "node-skipped", { nodeId });
        options?.onLog?.("info", `Skipped node ${nodeId}: condition not met`);
        return;
      }
    }

    // Handle human-review nodes
    if (node.type === "human-review") {
      stateManager.setNodeStatus(nodeId, "waiting-human");
      this.emitEvent(stateManager.executionId, "human-review-needed", { nodeId });
      return;
    }

    // Resolve inputs
    const inputs = scheduler.resolveInputs(nodeId, variables);
    stateManager.setNodeInputs(nodeId, inputs);
    stateManager.setNodeStatus(nodeId, "running");
    this.emitEvent(stateManager.executionId, "node-started", { nodeId });
    options?.onStepStart?.(nodeId);

    const maxAttempts = node.retry?.maxAttempts ?? 1;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        let outputs: Record<string, unknown>;

        if (options?.dryRun) {
          outputs = { _dryRun: true, nodeId, inputs };
        } else if (this.stepHandler) {
          outputs = await this.stepHandler(nodeId, inputs);
        } else {
          outputs = { _noHandler: true };
        }

        stateManager.setNodeOutputs(nodeId, outputs);
        stateManager.setNodeStatus(nodeId, "completed");
        this.emitEvent(stateManager.executionId, "node-completed", { nodeId, outputs });
        options?.onStepComplete?.(nodeId, outputs);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < maxAttempts) {
          const backoff = (node.retry?.backoffMs ?? 1000) * Math.pow(node.retry?.backoffMultiplier ?? 2, attempt - 1);
          options?.onLog?.("warn", `Node ${nodeId} attempt ${attempt} failed, retrying in ${backoff}ms`);
          await new Promise(resolve => setTimeout(resolve, backoff));
        }
      }
    }

    // All attempts failed
    const errorMsg = lastError?.message ?? "Unknown error";
    stateManager.setNodeError(nodeId, errorMsg);

    if (node.errorPolicy === "skip") {
      stateManager.setNodeStatus(nodeId, "skipped");
      this.emitEvent(stateManager.executionId, "node-skipped", { nodeId });
      options?.onLog?.("warn", `Node ${nodeId} failed but skipped due to error policy`);
    } else {
      stateManager.setNodeStatus(nodeId, "failed");
      this.emitEvent(stateManager.executionId, "node-failed", { nodeId, error: errorMsg });
      options?.onStepFailed?.(nodeId, errorMsg);
    }
  }

  private async handleHumanReview(
    waitingNodes: string[],
    pipeline: PipelineDefinition,
    stateManager: StateManager,
    options?: ExecutionOptions,
  ): Promise<void> {
    for (const nodeId of waitingNodes) {
      const node = pipeline.nodes.find(n => n.id === nodeId);
      const prompt = node?.humanReview?.prompt ?? `Approve step "${nodeId}"?`;

      if (options?.onHumanReview) {
        const approved = await options.onHumanReview(nodeId, prompt);
        stateManager.setNodeStatus(nodeId, approved ? "completed" : "skipped");
        stateManager.setNodeOutputs(nodeId, { approved });
      } else {
        // No handler — auto-approve in non-interactive mode
        stateManager.setNodeStatus(nodeId, "completed");
        stateManager.setNodeOutputs(nodeId, { approved: true, autoApproved: true });
      }
    }
  }

  private evaluateCondition(condition: string, variables: Record<string, unknown>): boolean {
    try {
      // Simple expression evaluation with variable substitution
      const resolved = condition.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => {
        return JSON.stringify(variables[name]);
      });
      // Evaluate simple boolean expressions safely
      return Boolean(new Function("variables", `with(variables) { return ${resolved}; }`)(variables));
    } catch {
      return true; // Default to running on evaluation failure
    }
  }

  private emitEvent(executionId: string, type: ExecutionEvent["type"], data?: unknown): void {
    this.eventBus.emit("execution", {
      type,
      executionId,
      nodeId: typeof data === "object" && data !== null && "nodeId" in data ? (data as { nodeId: string }).nodeId : undefined,
      data,
      timestamp: Date.now(),
    });
  }
}
