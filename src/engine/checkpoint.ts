import type { PipelineExecutionState } from "../types/execution.js";
import type { PipelineDefinition } from "../types/pipeline.js";
import { StateManager } from "./state-manager.js";

export interface Checkpoint {
  id: string;
  pipeline: PipelineDefinition;
  executionState: Record<string, unknown>;
  createdAt: number;
}

/**
 * Creates serializable checkpoints of pipeline execution state.
 * Enables pause/resume and crash recovery.
 */
export class CheckpointManager {
  private checkpoints = new Map<string, Checkpoint>();

  save(pipeline: PipelineDefinition, stateManager: StateManager): Checkpoint {
    const checkpoint: Checkpoint = {
      id: stateManager.executionId,
      pipeline,
      executionState: stateManager.toJSON(),
      createdAt: Date.now(),
    };
    this.checkpoints.set(checkpoint.id, checkpoint);
    return checkpoint;
  }

  load(id: string): Checkpoint | undefined {
    return this.checkpoints.get(id);
  }

  restore(checkpoint: Checkpoint): { pipeline: PipelineDefinition; stateManager: StateManager } {
    return {
      pipeline: checkpoint.pipeline,
      stateManager: StateManager.fromJSON(checkpoint.executionState),
    };
  }

  list(): Checkpoint[] {
    return [...this.checkpoints.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  delete(id: string): boolean {
    return this.checkpoints.delete(id);
  }

  toJSON(): Checkpoint[] {
    return this.list();
  }
}
