import { describe, it, expect } from "vitest";
import { CheckpointManager } from "../../../src/engine/checkpoint.js";
import { StateManager } from "../../../src/engine/state-manager.js";
import type { PipelineDefinition } from "../../../src/types/pipeline.js";

const minimalPipeline: PipelineDefinition = {
  apiVersion: "pipeline-builder/v1",
  metadata: { name: "test", version: "1.0.0", tags: [] },
  nodes: [
    { id: "a", name: "A", type: "action", tool: "t:t", dependsOn: [], inputs: [], outputs: [], inputMappings: {}, errorPolicy: "fail", tags: [], metadata: {} },
  ],
  edges: [],
  variables: [],
  secrets: [],
  env: {},
  trigger: { type: "manual", config: {} },
  mcpServers: [],
  tags: [],
};

describe("CheckpointManager", () => {
  it("should save and load checkpoints", () => {
    const cm = new CheckpointManager();
    const state = new StateManager("test", ["a"]);
    state.setNodeStatus("a", "running");

    const checkpoint = cm.save(minimalPipeline, state);
    expect(checkpoint.id).toBe(state.executionId);

    const loaded = cm.load(checkpoint.id);
    expect(loaded).toBeDefined();
    expect(loaded!.pipeline.metadata.name).toBe("test");
  });

  it("should restore state from checkpoint", () => {
    const cm = new CheckpointManager();
    const state = new StateManager("test", ["a"]);
    state.setNodeStatus("a", "completed");
    state.setNodeOutputs("a", { result: "hello" });

    const checkpoint = cm.save(minimalPipeline, state);
    const restored = cm.restore(checkpoint);

    expect(restored.stateManager.getNodeState("a")?.status).toBe("completed");
    expect(restored.stateManager.getNodeState("a")?.outputs).toEqual({ result: "hello" });
  });

  it("should list checkpoints sorted by time", () => {
    const cm = new CheckpointManager();
    const s1 = new StateManager("p1", ["a"]);
    const s2 = new StateManager("p2", ["a"]);

    cm.save(minimalPipeline, s1);
    cm.save(minimalPipeline, s2);

    const list = cm.list();
    expect(list.length).toBe(2);
    expect(list[0].createdAt).toBeGreaterThanOrEqual(list[1].createdAt);
  });

  it("should delete checkpoints", () => {
    const cm = new CheckpointManager();
    const state = new StateManager("test", ["a"]);
    const checkpoint = cm.save(minimalPipeline, state);

    expect(cm.delete(checkpoint.id)).toBe(true);
    expect(cm.load(checkpoint.id)).toBeUndefined();
  });
});
