import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PipelineStore } from "../../../src/persistence/pipeline-store.js";

const testPipeline = {
  apiVersion: "pipeline-builder/v1" as const,
  metadata: { name: "test-pipeline", version: "1.0.0", description: "test" },
  nodes: [{ id: "step-a", name: "Step A", type: "action" as const, label: "Step A", tool: "shell:exec", toolInput: { command: "echo hi" }, inputMappings: {} }],
  edges: [],
  variables: [],
  triggers: [{ type: "manual" as const }],
};

describe("PipelineStore — path traversal protection", () => {
  let store: PipelineStore;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pipeline-store-security-"));
    store = new PipelineStore(tempDir);
    await store.init();
  });

  it("load() should reject relative path traversal like ../../etc/passwd", async () => {
    await expect(store.load("../../etc/passwd")).rejects.toThrow("Access denied");
  });

  it("load() should reject absolute paths outside the store directory", async () => {
    await expect(store.load("/etc/passwd")).rejects.toThrow("Access denied");
  });

  it("delete() should not throw for traversal names that don't match any file", async () => {
    // delete() first filters through listFiles(), which only returns .pipeline.yaml/.json
    // files within the directory. A traversal string like "../secret" won't match any
    // listed file, so delete silently does nothing — the guard is still in place for
    // any match that somehow resolves outside the directory.
    await expect(store.delete("../secret")).resolves.toBeUndefined();
  });

  it("load() should succeed for a valid pipeline saved in the store", async () => {
    const savedPath = await store.save(testPipeline, "yaml");

    const loaded = await store.load(savedPath);
    expect(loaded.metadata.name).toBe("test-pipeline");
    expect(loaded.nodes).toHaveLength(1);
    expect(loaded.nodes[0].id).toBe("step-a");
  });
});
