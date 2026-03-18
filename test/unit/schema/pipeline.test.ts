import { describe, it, expect } from "vitest";
import { PipelineDefinitionSchema, PipelineNodeSchema } from "../../../src/schema/index.js";

describe("Pipeline Schema", () => {
  describe("PipelineNodeSchema", () => {
    it("should validate a minimal action node", () => {
      const node = {
        id: "my-node",
        name: "My Node",
        type: "action",
        tool: "server:tool",
      };
      const result = PipelineNodeSchema.safeParse(node);
      expect(result.success).toBe(true);
    });

    it("should reject invalid node IDs", () => {
      const node = {
        id: "Invalid ID!",
        name: "Bad",
        type: "action",
      };
      const result = PipelineNodeSchema.safeParse(node);
      expect(result.success).toBe(false);
    });

    it("should apply defaults", () => {
      const node = {
        id: "test",
        name: "Test",
        type: "action",
        tool: "t:t",
      };
      const result = PipelineNodeSchema.parse(node);
      expect(result.dependsOn).toEqual([]);
      expect(result.inputs).toEqual([]);
      expect(result.outputs).toEqual([]);
      expect(result.tags).toEqual([]);
      expect(result.errorPolicy).toBe("fail");
    });
  });

  describe("PipelineDefinitionSchema", () => {
    it("should validate a complete pipeline", () => {
      const pipeline = {
        apiVersion: "pipeline-builder/v1",
        metadata: {
          name: "Test Pipeline",
          version: "1.0.0",
        },
        nodes: [
          { id: "start", name: "Start", type: "trigger" },
          { id: "process", name: "Process", type: "action", tool: "s:t", dependsOn: ["start"] },
        ],
        edges: [
          { from: "start", to: "process" },
        ],
      };

      const result = PipelineDefinitionSchema.safeParse(pipeline);
      expect(result.success).toBe(true);
    });

    it("should reject pipeline with no nodes", () => {
      const pipeline = {
        apiVersion: "pipeline-builder/v1",
        metadata: { name: "Empty" },
        nodes: [],
      };
      const result = PipelineDefinitionSchema.safeParse(pipeline);
      expect(result.success).toBe(false);
    });

    it("should apply defaults for optional fields", () => {
      const pipeline = {
        apiVersion: "pipeline-builder/v1",
        metadata: { name: "Minimal" },
        nodes: [{ id: "a", name: "A", type: "action", tool: "s:t" }],
      };
      const result = PipelineDefinitionSchema.parse(pipeline);
      expect(result.edges).toEqual([]);
      expect(result.variables).toEqual([]);
      expect(result.secrets).toEqual([]);
      expect(result.mcpServers).toEqual([]);
      expect(result.trigger.type).toBe("manual");
    });
  });
});
