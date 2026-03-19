import { describe, it, expect } from "vitest";
import { visualizeDAG, visualizeFlow } from "../../../src/dag/visualize.js";
import { DAG } from "../../../src/dag/graph.js";
import type { PipelineNode, PipelineEdge } from "../../../src/types/pipeline.js";

function makeNode(id: string, name: string, type: PipelineNode["type"] = "action"): PipelineNode {
  return { id, name, type, dependsOn: [], inputs: [], outputs: [], inputMappings: {}, errorPolicy: "fail", tags: [], metadata: {} };
}

describe("visualizeFlow", () => {
  it("should render a linear pipeline", () => {
    const dag = new DAG<PipelineNode, PipelineEdge>();
    dag.addNode("a", makeNode("a", "Build"));
    dag.addNode("b", makeNode("b", "Test"));
    dag.addNode("c", makeNode("c", "Deploy"));
    dag.addEdge("a", "b");
    dag.addEdge("b", "c");

    const flow = visualizeFlow(dag);
    expect(flow).toBe("[Build] → [Test] → [Deploy]");
  });

  it("should render parallel nodes with pipes", () => {
    const dag = new DAG<PipelineNode, PipelineEdge>();
    dag.addNode("root", makeNode("root", "Start", "trigger"));
    dag.addNode("a", makeNode("a", "Lint"));
    dag.addNode("b", makeNode("b", "Test"));
    dag.addNode("end", makeNode("end", "Build"));
    dag.addEdge("root", "a");
    dag.addEdge("root", "b");
    dag.addEdge("a", "end");
    dag.addEdge("b", "end");

    const flow = visualizeFlow(dag);
    expect(flow).toContain("[Lint | Test]");
    expect(flow).toContain("[Start]");
    expect(flow).toContain("[Build]");
  });

  it("should handle empty DAG", () => {
    const dag = new DAG<PipelineNode, PipelineEdge>();
    expect(visualizeFlow(dag)).toBe("(empty)");
  });
});

describe("visualizeDAG", () => {
  it("should contain node names and IDs", () => {
    const dag = new DAG<PipelineNode, PipelineEdge>();
    dag.addNode("checkout", makeNode("checkout", "Checkout Code", "trigger"));
    dag.addNode("test", makeNode("test", "Run Tests"));
    dag.addEdge("checkout", "test");

    const viz = visualizeDAG(dag);
    expect(viz).toContain("Checkout Code");
    expect(viz).toContain("checkout");
    expect(viz).toContain("Run Tests");
    expect(viz).toContain("test");
  });

  it("should show connections", () => {
    const dag = new DAG<PipelineNode, PipelineEdge>();
    dag.addNode("a", makeNode("a", "Build"));
    dag.addNode("b", makeNode("b", "Deploy"));
    dag.addEdge("a", "b");

    const viz = visualizeDAG(dag);
    expect(viz).toContain("Build ──> Deploy");
  });

  it("should show wave headers", () => {
    const dag = new DAG<PipelineNode, PipelineEdge>();
    dag.addNode("a", makeNode("a", "A"));
    dag.addNode("b", makeNode("b", "B"));
    dag.addEdge("a", "b");

    const viz = visualizeDAG(dag);
    expect(viz).toContain("Wave 1");
    expect(viz).toContain("Wave 2");
  });

  it("should show node type icons", () => {
    const dag = new DAG<PipelineNode, PipelineEdge>();
    dag.addNode("t", makeNode("t", "Start", "trigger"));
    dag.addNode("h", makeNode("h", "Review", "human-review"));

    const viz = visualizeDAG(dag);
    expect(viz).toContain(">>"); // trigger icon
    expect(viz).toContain("!!"); // human-review icon
  });

  it("should show summary stats", () => {
    const dag = new DAG<PipelineNode, PipelineEdge>();
    dag.addNode("a", makeNode("a", "A"));
    dag.addNode("b", makeNode("b", "B"));
    dag.addEdge("a", "b");

    const viz = visualizeDAG(dag);
    expect(viz).toContain("Nodes: 2");
    expect(viz).toContain("Edges: 1");
    expect(viz).toContain("Waves: 2");
  });
});
