import { describe, it, expect } from "vitest";
import { Scheduler } from "../../../src/engine/scheduler.js";
import { StateManager } from "../../../src/engine/state-manager.js";
import { DAG } from "../../../src/dag/graph.js";
import type { PipelineNode, PipelineEdge } from "../../../src/types/pipeline.js";

function makeNode(id: string): PipelineNode {
  return { id, name: id, type: "action", tool: "t:t", dependsOn: [], inputs: [], outputs: [], inputMappings: {}, errorPolicy: "fail", tags: [], metadata: {} };
}

function buildTestDAG() {
  const dag = new DAG<PipelineNode, PipelineEdge>();
  dag.addNode("a", makeNode("a"));
  dag.addNode("b", makeNode("b"));
  dag.addNode("c", makeNode("c"));
  dag.addNode("d", makeNode("d"));
  dag.addEdge("a", "b");
  dag.addEdge("a", "c");
  dag.addEdge("b", "d");
  dag.addEdge("c", "d");
  return dag;
}

describe("Scheduler", () => {
  it("should return root nodes as initially ready", () => {
    const dag = buildTestDAG();
    const state = new StateManager("test", ["a", "b", "c", "d"]);
    const sched = new Scheduler(dag, state);

    expect(sched.getReadyNodes()).toEqual(["a"]);
  });

  it("should return parallel nodes after root completes", () => {
    const dag = buildTestDAG();
    const state = new StateManager("test", ["a", "b", "c", "d"]);
    const sched = new Scheduler(dag, state);

    state.setNodeStatus("a", "completed");
    const ready = sched.getReadyNodes();
    expect(ready.sort()).toEqual(["b", "c"]);
  });

  it("should not return nodes whose deps aren't all complete", () => {
    const dag = buildTestDAG();
    const state = new StateManager("test", ["a", "b", "c", "d"]);
    const sched = new Scheduler(dag, state);

    state.setNodeStatus("a", "completed");
    state.setNodeStatus("b", "completed");
    // c is still pending, so d shouldn't be ready
    const ready = sched.getReadyNodes();
    expect(ready).not.toContain("d");
  });

  it("should return d when both b and c are complete", () => {
    const dag = buildTestDAG();
    const state = new StateManager("test", ["a", "b", "c", "d"]);
    const sched = new Scheduler(dag, state);

    state.setNodeStatus("a", "completed");
    state.setNodeStatus("b", "completed");
    state.setNodeStatus("c", "completed");
    expect(sched.getReadyNodes()).toEqual(["d"]);
  });

  it("should treat skipped nodes as complete for dependency purposes", () => {
    const dag = buildTestDAG();
    const state = new StateManager("test", ["a", "b", "c", "d"]);
    const sched = new Scheduler(dag, state);

    state.setNodeStatus("a", "completed");
    state.setNodeStatus("b", "completed");
    state.setNodeStatus("c", "skipped"); // skipped counts as complete
    expect(sched.getReadyNodes()).toEqual(["d"]);
  });

  it("should report completion correctly", () => {
    const dag = buildTestDAG();
    const state = new StateManager("test", ["a", "b", "c", "d"]);
    const sched = new Scheduler(dag, state);

    expect(sched.isComplete()).toBe(false);

    state.setNodeStatus("a", "completed");
    state.setNodeStatus("b", "completed");
    state.setNodeStatus("c", "completed");
    state.setNodeStatus("d", "completed");
    expect(sched.isComplete()).toBe(true);
  });

  it("should resolve input mappings from node outputs", () => {
    const dag = new DAG<PipelineNode, PipelineEdge>();
    const nodeA = makeNode("a");
    const nodeB = { ...makeNode("b"), inputMappings: { tag: "nodes.a.outputs.imageTag" } };
    dag.addNode("a", nodeA);
    dag.addNode("b", nodeB);
    dag.addEdge("a", "b");

    const state = new StateManager("test", ["a", "b"]);
    state.setNodeStatus("a", "completed");
    state.setNodeOutputs("a", { imageTag: "v1.2.3" });

    const sched = new Scheduler(dag, state);
    const inputs = sched.resolveInputs("b", {});
    expect(inputs.tag).toBe("v1.2.3");
  });

  it("should resolve variables references", () => {
    const dag = new DAG<PipelineNode, PipelineEdge>();
    const node = { ...makeNode("a"), inputMappings: { env: "variables.environment" } };
    dag.addNode("a", node);

    const state = new StateManager("test", ["a"]);
    const sched = new Scheduler(dag, state);

    const inputs = sched.resolveInputs("a", { environment: "production" });
    expect(inputs.env).toBe("production");
  });

  it("should resolve template strings in toolInput", () => {
    const dag = new DAG<PipelineNode, PipelineEdge>();
    const node = { ...makeNode("a"), toolInput: { cmd: "deploy to {{ environment }}" } };
    dag.addNode("a", node);

    const state = new StateManager("test", ["a"]);
    const sched = new Scheduler(dag, state);

    const inputs = sched.resolveInputs("a", { environment: "staging" });
    expect(inputs.cmd).toBe("deploy to staging");
  });

  it("should return execution plan as parallel groups", () => {
    const dag = buildTestDAG();
    const state = new StateManager("test", ["a", "b", "c", "d"]);
    const sched = new Scheduler(dag, state);

    const plan = sched.getExecutionPlan();
    expect(plan.length).toBe(3); // [a], [b,c], [d]
    expect(plan[0]).toEqual(["a"]);
    expect(plan[1].sort()).toEqual(["b", "c"]);
    expect(plan[2]).toEqual(["d"]);
  });
});
