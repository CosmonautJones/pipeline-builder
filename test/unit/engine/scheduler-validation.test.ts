import { describe, it, expect } from "vitest";
import { Scheduler } from "../../../src/engine/scheduler.js";
import { DAG } from "../../../src/dag/graph.js";
import { StateManager } from "../../../src/engine/state-manager.js";
import type { PipelineNode, PipelineEdge } from "../../../src/types/pipeline.js";

function makeNode(
  id: string,
  overrides: Partial<PipelineNode> = {},
): PipelineNode {
  return {
    id,
    name: id,
    type: "action",
    tool: "test:tool",
    toolInput: {},
    inputMappings: {},
    dependsOn: [],
    inputs: [],
    outputs: [],
    errorPolicy: "fail",
    tags: [],
    metadata: {},
    ...overrides,
  };
}

describe("Scheduler resolveInputs validation", () => {
  it("should throw when inputMappings reference a non-existent node", () => {
    const dag = new DAG<PipelineNode, PipelineEdge>();
    dag.addNode("a", makeNode("a"));
    dag.addNode(
      "b",
      makeNode("b", {
        inputMappings: { result: "nodes.nonexistent.outputs.value" },
      }),
    );
    dag.addEdge("a", "b");

    const state = new StateManager("test", ["a", "b"]);
    state.setNodeStatus("a", "completed");
    state.setNodeOutputs("a", { value: "hello" });

    const scheduler = new Scheduler(dag, state);

    expect(() => scheduler.resolveInputs("b", {})).toThrow(
      /unknown node "nonexistent"/,
    );
  });

  it("should succeed when referencing an existing node", () => {
    const dag = new DAG<PipelineNode, PipelineEdge>();
    dag.addNode("a", makeNode("a"));
    dag.addNode(
      "b",
      makeNode("b", {
        inputMappings: { result: "nodes.a.outputs.value" },
      }),
    );
    dag.addEdge("a", "b");

    const state = new StateManager("test", ["a", "b"]);
    state.setNodeStatus("a", "completed");
    state.setNodeOutputs("a", { value: "hello" });

    const scheduler = new Scheduler(dag, state);
    const inputs = scheduler.resolveInputs("b", {});

    expect(inputs.result).toBe("hello");
  });

  it("should resolve variables correctly", () => {
    const dag = new DAG<PipelineNode, PipelineEdge>();
    dag.addNode("a", makeNode("a"));
    dag.addNode(
      "b",
      makeNode("b", {
        inputMappings: { name: "variables.myVar" },
      }),
    );
    dag.addEdge("a", "b");

    const state = new StateManager("test", ["a", "b"]);
    state.setNodeStatus("a", "completed");
    state.setNodeOutputs("a", {});

    const scheduler = new Scheduler(dag, state);
    const inputs = scheduler.resolveInputs("b", { myVar: "test-value" });

    expect(inputs.name).toBe("test-value");
  });
});
