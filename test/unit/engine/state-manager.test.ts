import { describe, it, expect } from "vitest";
import { StateManager } from "../../../src/engine/state-manager.js";

describe("StateManager", () => {
  it("should initialize all nodes as pending", () => {
    const sm = new StateManager("test-pipeline", ["a", "b", "c"]);

    expect(sm.getNodeState("a")?.status).toBe("pending");
    expect(sm.getNodeState("b")?.status).toBe("pending");
    expect(sm.getNodeState("c")?.status).toBe("pending");
    expect(sm.pipelineStatus).toBe("pending");
  });

  it("should track node status transitions", () => {
    const sm = new StateManager("test", ["a"]);

    sm.setNodeStatus("a", "running");
    expect(sm.getNodeState("a")?.status).toBe("running");
    expect(sm.getNodeState("a")?.attempts).toBe(1);

    sm.setNodeStatus("a", "completed");
    expect(sm.getNodeState("a")?.status).toBe("completed");
    expect(sm.isNodeComplete("a")).toBe(true);
  });

  it("should track node outputs", () => {
    const sm = new StateManager("test", ["a"]);

    sm.setNodeOutputs("a", { result: "hello", count: 42 });
    expect(sm.getNodeState("a")?.outputs).toEqual({ result: "hello", count: 42 });
  });

  it("should track variables", () => {
    const sm = new StateManager("test", []);

    sm.setVariable("foo", "bar");
    expect(sm.getVariable("foo")).toBe("bar");
  });

  it("should report terminal state", () => {
    const sm = new StateManager("test", ["a", "b"]);

    expect(sm.areAllNodesTerminal()).toBe(false);

    sm.setNodeStatus("a", "completed");
    expect(sm.areAllNodesTerminal()).toBe(false);

    sm.setNodeStatus("b", "failed");
    expect(sm.areAllNodesTerminal()).toBe(true);
    expect(sm.hasFailedNodes()).toBe(true);
  });

  it("should query nodes by status", () => {
    const sm = new StateManager("test", ["a", "b", "c"]);

    sm.setNodeStatus("a", "completed");
    sm.setNodeStatus("b", "running");

    expect(sm.getNodesByStatus("pending")).toEqual(["c"]);
    expect(sm.getNodesByStatus("completed")).toEqual(["a"]);
    expect(sm.getNodesByStatus("running")).toEqual(["b"]);
  });
});
