import { describe, it, expect } from "vitest";
import { DAG } from "../../../src/dag/graph.js";
import { DAGCycleError } from "../../../src/utils/errors.js";

describe("DAG", () => {
  describe("node operations", () => {
    it("should add and retrieve nodes", () => {
      const dag = new DAG<string>();
      dag.addNode("a", "nodeA");
      dag.addNode("b", "nodeB");

      expect(dag.getNode("a")?.data).toBe("nodeA");
      expect(dag.getNode("b")?.data).toBe("nodeB");
      expect(dag.nodeCount).toBe(2);
    });

    it("should remove nodes and connected edges", () => {
      const dag = new DAG<string>();
      dag.addNode("a", "A");
      dag.addNode("b", "B");
      dag.addNode("c", "C");
      dag.addEdge("a", "b");
      dag.addEdge("b", "c");

      dag.removeNode("b");

      expect(dag.nodeCount).toBe(2);
      expect(dag.hasNode("b")).toBe(false);
      expect(dag.edgeCount).toBe(0);
    });
  });

  describe("edge operations", () => {
    it("should add edges between existing nodes", () => {
      const dag = new DAG<string>();
      dag.addNode("a", "A");
      dag.addNode("b", "B");
      dag.addEdge("a", "b");

      expect(dag.hasEdge("a", "b")).toBe(true);
      expect(dag.hasEdge("b", "a")).toBe(false);
      expect(dag.edgeCount).toBe(1);
    });

    it("should reject edges to non-existent nodes", () => {
      const dag = new DAG<string>();
      dag.addNode("a", "A");

      expect(() => dag.addEdge("a", "z")).toThrow('Node "z" does not exist');
    });

    it("should reject self-loops", () => {
      const dag = new DAG<string>();
      dag.addNode("a", "A");

      expect(() => dag.addEdge("a", "a")).toThrow("Self-loops are not allowed");
    });
  });

  describe("traversal", () => {
    it("should return successors and predecessors", () => {
      const dag = new DAG<string>();
      dag.addNode("a", "A");
      dag.addNode("b", "B");
      dag.addNode("c", "C");
      dag.addEdge("a", "b");
      dag.addEdge("a", "c");

      expect(dag.getSuccessors("a")).toContain("b");
      expect(dag.getSuccessors("a")).toContain("c");
      expect(dag.getPredecessors("b")).toEqual(["a"]);
    });

    it("should identify roots and leaves", () => {
      const dag = new DAG<string>();
      dag.addNode("a", "A");
      dag.addNode("b", "B");
      dag.addNode("c", "C");
      dag.addEdge("a", "b");
      dag.addEdge("b", "c");

      expect(dag.getRoots()).toEqual(["a"]);
      expect(dag.getLeaves()).toEqual(["c"]);
    });
  });

  describe("topological sort", () => {
    it("should sort a linear chain", () => {
      const dag = new DAG<string>();
      dag.addNode("c", "C");
      dag.addNode("a", "A");
      dag.addNode("b", "B");
      dag.addEdge("a", "b");
      dag.addEdge("b", "c");

      const sorted = dag.topologicalSort();
      expect(sorted.indexOf("a")).toBeLessThan(sorted.indexOf("b"));
      expect(sorted.indexOf("b")).toBeLessThan(sorted.indexOf("c"));
    });

    it("should sort a diamond DAG", () => {
      const dag = new DAG<string>();
      dag.addNode("a", "A");
      dag.addNode("b", "B");
      dag.addNode("c", "C");
      dag.addNode("d", "D");
      dag.addEdge("a", "b");
      dag.addEdge("a", "c");
      dag.addEdge("b", "d");
      dag.addEdge("c", "d");

      const sorted = dag.topologicalSort();
      expect(sorted[0]).toBe("a");
      expect(sorted[sorted.length - 1]).toBe("d");
    });

    it("should throw DAGCycleError on cycles", () => {
      const dag = new DAG<string>();
      dag.addNode("a", "A");
      dag.addNode("b", "B");
      dag.addNode("c", "C");
      dag.addEdge("a", "b");
      dag.addEdge("b", "c");
      dag.addEdge("c", "a");

      expect(() => dag.topologicalSort()).toThrow(DAGCycleError);
    });
  });

  describe("cycle detection", () => {
    it("should detect no cycle in a valid DAG", () => {
      const dag = new DAG<string>();
      dag.addNode("a", "A");
      dag.addNode("b", "B");
      dag.addEdge("a", "b");

      expect(dag.hasCycle()).toBe(false);
    });

    it("should detect a cycle", () => {
      const dag = new DAG<string>();
      dag.addNode("a", "A");
      dag.addNode("b", "B");
      dag.addEdge("a", "b");
      dag.addEdge("b", "a");

      expect(dag.hasCycle()).toBe(true);
    });
  });

  describe("parallel groups", () => {
    it("should group independent nodes together", () => {
      const dag = new DAG<string>();
      dag.addNode("a", "A");
      dag.addNode("b", "B");
      dag.addNode("c", "C");
      dag.addNode("d", "D");
      dag.addEdge("a", "b");
      dag.addEdge("a", "c");
      dag.addEdge("b", "d");
      dag.addEdge("c", "d");

      const groups = dag.getParallelGroups();
      expect(groups.length).toBe(3);
      expect(groups[0]).toEqual(["a"]);
      expect(groups[1].sort()).toEqual(["b", "c"]);
      expect(groups[2]).toEqual(["d"]);
    });

    it("should handle single-node DAG", () => {
      const dag = new DAG<string>();
      dag.addNode("a", "A");

      const groups = dag.getParallelGroups();
      expect(groups).toEqual([["a"]]);
    });
  });

  describe("serialization", () => {
    it("should round-trip through JSON", () => {
      const dag = new DAG<string, string>();
      dag.addNode("a", "A");
      dag.addNode("b", "B");
      dag.addEdge("a", "b", "edge-label");

      const json = dag.toJSON();
      const restored = DAG.fromJSON(json);

      expect(restored.nodeCount).toBe(2);
      expect(restored.edgeCount).toBe(1);
      expect(restored.getNode("a")?.data).toBe("A");
      expect(restored.getEdge("a", "b")?.data).toBe("edge-label");
    });
  });
});
