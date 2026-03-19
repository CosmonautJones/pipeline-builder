import { describe, it, expect, beforeEach } from "vitest";
import { PipelineStore } from "../../../src/persistence/pipeline-store.js";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PipelineDefinition } from "../../../src/types/pipeline.js";

const testPipeline: PipelineDefinition = {
  apiVersion: "pipeline-builder/v1",
  metadata: { name: "Test Pipeline", version: "1.0.0", tags: ["test"] },
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

describe("PipelineStore", () => {
  let store: PipelineStore;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pipeline-store-test-"));
    store = new PipelineStore(tempDir);
  });

  it("should save and load YAML pipelines", async () => {
    const path = await store.save(testPipeline, "yaml");
    expect(path).toContain(".pipeline.yaml");

    const loaded = await store.load(path);
    expect(loaded.metadata.name).toBe("Test Pipeline");
    expect(loaded.nodes.length).toBe(1);
  });

  it("should save and load JSON pipelines", async () => {
    const path = await store.save(testPipeline, "json");
    expect(path).toContain(".pipeline.json");

    const loaded = await store.load(path);
    expect(loaded.metadata.name).toBe("Test Pipeline");
  });

  it("should list saved pipelines", async () => {
    await store.save(testPipeline, "yaml");
    const list = await store.list();
    expect(list.length).toBe(1);
    expect(list[0].name).toBe("test-pipeline");
    expect(list[0].format).toBe("yaml");
  });

  it("should sanitize filenames", async () => {
    const pipeline = { ...testPipeline, metadata: { ...testPipeline.metadata, name: "My Awesome Pipeline!!!" } };
    const path = await store.save(pipeline);
    expect(path).toContain("my-awesome-pipeline");
    expect(path).not.toContain("!");
  });

  it("should delete pipelines", async () => {
    await store.save(testPipeline);
    let list = await store.list();
    expect(list.length).toBe(1);

    await store.delete("test-pipeline");
    list = await store.list();
    expect(list.length).toBe(0);
  });

  it("should validate on load (reject invalid)", async () => {
    const { writeFile } = await import("node:fs/promises");
    await store.init();
    await writeFile(join(tempDir, "bad.pipeline.yaml"), "invalid: true\n");

    await expect(store.load(join(tempDir, "bad.pipeline.yaml"))).rejects.toThrow();
  });
});
