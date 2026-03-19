import { describe, it, expect } from "vitest";
import { buildDAGFromPipeline } from "../../../src/dag/builder.js";
import { validatePipelineDAG } from "../../../src/dag/validator.js";
import type { PipelineDefinition } from "../../../src/types/pipeline.js";

const makePipeline = (overrides: Partial<PipelineDefinition> = {}): PipelineDefinition => ({
  apiVersion: "pipeline-builder/v1",
  metadata: { name: "test", version: "1.0.0", tags: [] },
  nodes: [
    { id: "a", name: "A", type: "trigger", dependsOn: [], inputs: [], outputs: [], inputMappings: {}, errorPolicy: "fail", tags: [], metadata: {} },
    { id: "b", name: "B", type: "action", tool: "s:t", dependsOn: ["a"], inputs: [], outputs: [], inputMappings: {}, errorPolicy: "fail", tags: [], metadata: {} },
  ],
  edges: [{ from: "a", to: "b" }],
  variables: [],
  secrets: [],
  env: {},
  trigger: { type: "manual", config: {} },
  mcpServers: [],
  tags: [],
  ...overrides,
});

describe("buildDAGFromPipeline", () => {
  it("should build DAG from explicit edges", () => {
    const dag = buildDAGFromPipeline(makePipeline());
    expect(dag.nodeCount).toBe(2);
    expect(dag.edgeCount).toBe(1);
    expect(dag.hasEdge("a", "b")).toBe(true);
  });

  it("should build DAG from dependsOn (implicit edges)", () => {
    const pipeline = makePipeline({
      edges: [], // no explicit edges
    });
    const dag = buildDAGFromPipeline(pipeline);
    // dependsOn: ["a"] on node b creates an implicit edge
    expect(dag.hasEdge("a", "b")).toBe(true);
  });

  it("should not duplicate edges from both explicit and dependsOn", () => {
    const dag = buildDAGFromPipeline(makePipeline());
    // Both explicit edge and dependsOn point a→b, should only have 1 edge
    expect(dag.edgeCount).toBe(1);
  });
});

describe("validatePipelineDAG", () => {
  it("should pass a valid pipeline", () => {
    const pipeline = makePipeline();
    const dag = buildDAGFromPipeline(pipeline);
    const result = validatePipelineDAG(dag, pipeline);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("should detect action nodes without tools", () => {
    const pipeline = makePipeline({
      nodes: [
        { id: "a", name: "A", type: "action", dependsOn: [], inputs: [], outputs: [], inputMappings: {}, errorPolicy: "fail", tags: [], metadata: {} },
        // no tool specified!
      ],
      edges: [],
    });
    const dag = buildDAGFromPipeline(pipeline);
    const result = validatePipelineDAG(dag, pipeline);
    expect(result.errors.some(e => e.includes("no tool"))).toBe(true);
  });

  it("should detect condition nodes without conditions", () => {
    const pipeline = makePipeline({
      nodes: [
        { id: "a", name: "A", type: "condition", dependsOn: [], inputs: [], outputs: [], inputMappings: {}, errorPolicy: "fail", tags: [], metadata: {} },
      ],
      edges: [],
    });
    const dag = buildDAGFromPipeline(pipeline);
    const result = validatePipelineDAG(dag, pipeline);
    expect(result.errors.some(e => e.includes("condition"))).toBe(true);
  });

  it("should detect invalid node references in edges", () => {
    // buildDAGFromPipeline throws when edge references non-existent node
    const pipeline = makePipeline({
      edges: [{ from: "a", to: "nonexistent" }],
    });
    expect(() => buildDAGFromPipeline(pipeline)).toThrow("nonexistent");
  });

  it("should detect invalid input mapping references", () => {
    const pipeline = makePipeline({
      nodes: [
        { id: "a", name: "A", type: "trigger", dependsOn: [], inputs: [], outputs: [], inputMappings: {}, errorPolicy: "fail", tags: [], metadata: {} },
        { id: "b", name: "B", type: "action", tool: "s:t", dependsOn: ["a"], inputs: [], outputs: [], inputMappings: { foo: "nodes.nonexistent.outputs.bar" }, errorPolicy: "fail", tags: [], metadata: {} },
      ],
    });
    const dag = buildDAGFromPipeline(pipeline);
    const result = validatePipelineDAG(dag, pipeline);
    expect(result.errors.some(e => e.includes("nonexistent"))).toBe(true);
  });

  it("should warn about non-trigger roots", () => {
    const pipeline = makePipeline({
      nodes: [
        { id: "a", name: "A", type: "action", tool: "s:t", dependsOn: [], inputs: [], outputs: [], inputMappings: {}, errorPolicy: "fail", tags: [], metadata: {} },
        { id: "b", name: "B", type: "action", tool: "s:t", dependsOn: [], inputs: [], outputs: [], inputMappings: {}, errorPolicy: "fail", tags: [], metadata: {} },
      ],
      edges: [],
    });
    const dag = buildDAGFromPipeline(pipeline);
    const result = validatePipelineDAG(dag, pipeline);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
