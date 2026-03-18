import { describe, it, expect } from "vitest";
import { PipelineRuntime } from "../../../src/engine/runtime.js";
import type { PipelineDefinition } from "../../../src/types/pipeline.js";

const simplePipeline: PipelineDefinition = {
  apiVersion: "pipeline-builder/v1",
  metadata: { name: "test", version: "1.0.0", tags: [] },
  nodes: [
    { id: "a", name: "Step A", type: "action", tool: "test:echo", dependsOn: [], inputs: [], outputs: [], inputMappings: {}, errorPolicy: "fail", tags: [], metadata: {} },
    { id: "b", name: "Step B", type: "action", tool: "test:echo", dependsOn: ["a"], inputs: [], outputs: [], inputMappings: {}, errorPolicy: "fail", tags: [], metadata: {} },
  ],
  edges: [{ from: "a", to: "b" }],
  variables: [],
  secrets: [],
  env: {},
  trigger: { type: "manual", config: {} },
  mcpServers: [],
  tags: [],
};

describe("PipelineRuntime", () => {
  it("should execute a simple two-node pipeline in dry-run mode", async () => {
    const runtime = new PipelineRuntime();
    const result = await runtime.execute(simplePipeline, { dryRun: true });

    expect(result.status).toBe("completed");
    expect(result.nodes.get("a")?.status).toBe("completed");
    expect(result.nodes.get("b")?.status).toBe("completed");
  });

  it("should execute nodes in order respecting dependencies", async () => {
    const runtime = new PipelineRuntime();
    const executionOrder: string[] = [];

    runtime.onStep(async (nodeId) => {
      executionOrder.push(nodeId);
      return { done: true };
    });

    await runtime.execute(simplePipeline);

    expect(executionOrder).toEqual(["a", "b"]);
  });

  it("should handle step failures", async () => {
    const runtime = new PipelineRuntime();

    runtime.onStep(async (nodeId) => {
      if (nodeId === "a") throw new Error("boom");
      return {};
    });

    const result = await runtime.execute(simplePipeline);

    expect(result.status).toBe("failed");
    expect(result.nodes.get("a")?.status).toBe("failed");
    // b should remain pending since a failed
    expect(result.nodes.get("b")?.status).toBe("pending");
  });

  it("should run parallel nodes concurrently", async () => {
    const parallelPipeline: PipelineDefinition = {
      ...simplePipeline,
      nodes: [
        { id: "root", name: "Root", type: "trigger", dependsOn: [], inputs: [], outputs: [], inputMappings: {}, errorPolicy: "fail", tags: [], metadata: {} },
        { id: "a", name: "A", type: "action", tool: "t:t", dependsOn: ["root"], inputs: [], outputs: [], inputMappings: {}, errorPolicy: "fail", tags: [], metadata: {} },
        { id: "b", name: "B", type: "action", tool: "t:t", dependsOn: ["root"], inputs: [], outputs: [], inputMappings: {}, errorPolicy: "fail", tags: [], metadata: {} },
        { id: "end", name: "End", type: "action", tool: "t:t", dependsOn: ["a", "b"], inputs: [], outputs: [], inputMappings: {}, errorPolicy: "fail", tags: [], metadata: {} },
      ],
      edges: [
        { from: "root", to: "a" },
        { from: "root", to: "b" },
        { from: "a", to: "end" },
        { from: "b", to: "end" },
      ],
    };

    const runtime = new PipelineRuntime();
    const result = await runtime.execute(parallelPipeline, { dryRun: true });

    expect(result.status).toBe("completed");
    expect([...result.nodes.values()].every(n => n.status === "completed")).toBe(true);
  });

  it("should skip nodes with error policy 'skip' on failure", async () => {
    const skipPipeline: PipelineDefinition = {
      ...simplePipeline,
      nodes: [
        { id: "a", name: "A", type: "action", tool: "t:t", dependsOn: [], inputs: [], outputs: [], inputMappings: {}, errorPolicy: "skip", tags: [], metadata: {} },
        { id: "b", name: "B", type: "action", tool: "t:t", dependsOn: ["a"], inputs: [], outputs: [], inputMappings: {}, errorPolicy: "fail", tags: [], metadata: {} },
      ],
    };

    const runtime = new PipelineRuntime();
    runtime.onStep(async (nodeId) => {
      if (nodeId === "a") throw new Error("fail");
      return {};
    });

    const result = await runtime.execute(skipPipeline);
    expect(result.nodes.get("a")?.status).toBe("skipped");
    expect(result.nodes.get("b")?.status).toBe("completed");
  });
});
