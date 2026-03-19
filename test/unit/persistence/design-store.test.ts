import { describe, it, expect, beforeEach } from "vitest";
import { DesignStore } from "../../../src/persistence/design-store.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("DesignStore", () => {
  let store: DesignStore;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "design-store-test-"));
    store = new DesignStore(tempDir);
  });

  const makeRecord = (domain: string, outcome: "success" | "failure" | "rejected") => ({
    id: `test-${Date.now()}-${Math.random()}`,
    timestamp: Date.now(),
    intent: {
      rawInput: "test",
      goal: "test goal",
      constraints: [],
      preferences: [],
      suggestedTools: [],
      confidence: 0.8,
    },
    domain,
    outcome,
    tags: [domain],
  });

  it("should save and list records", async () => {
    await store.save(makeRecord("ci-cd", "success"));
    await store.save(makeRecord("ci-cd", "failure"));

    const records = await store.list();
    expect(records.length).toBe(2);
  });

  it("should find similar successful designs by domain", async () => {
    await store.save(makeRecord("ci-cd", "success"));
    await store.save(makeRecord("data-processing", "success"));
    await store.save(makeRecord("ci-cd", "failure"));

    const similar = await store.findSimilar("ci-cd");
    expect(similar.length).toBe(1);
    expect(similar[0].domain).toBe("ci-cd");
    expect(similar[0].outcome).toBe("success");
  });

  it("should find failures for a domain", async () => {
    await store.save(makeRecord("ci-cd", "success"));
    await store.save(makeRecord("ci-cd", "failure"));

    const failures = await store.findFailures("ci-cd");
    expect(failures.length).toBe(1);
    expect(failures[0].outcome).toBe("failure");
  });

  it("should compute stats", async () => {
    await store.save(makeRecord("ci-cd", "success"));
    await store.save(makeRecord("ci-cd", "failure"));
    await store.save(makeRecord("data-processing", "success"));

    const stats = await store.stats();
    expect(stats.total).toBe(3);
    expect(stats.success).toBe(2);
    expect(stats.failure).toBe(1);
    expect(stats.byDomain["ci-cd"]).toBe(2);
  });

  it("should persist across instances", async () => {
    await store.save(makeRecord("ci-cd", "success"));

    const store2 = new DesignStore(tempDir);
    const records = await store2.list();
    expect(records.length).toBe(1);
  });
});
