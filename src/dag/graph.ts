import { DAGCycleError } from "../utils/errors.js";

export interface DAGNode<T> {
  id: string;
  data: T;
}

export interface DAGEdge<E = void> {
  from: string;
  to: string;
  data?: E;
}

/**
 * Generic Directed Acyclic Graph.
 * Uses adjacency lists for both forward and reverse edges.
 */
export class DAG<N, E = void> {
  private nodes = new Map<string, DAGNode<N>>();
  private forward = new Map<string, Set<string>>();   // from → [to]
  private reverse = new Map<string, Set<string>>();   // to → [from]
  private edgeData = new Map<string, DAGEdge<E>>();   // "from->to" → edge

  private edgeKey(from: string, to: string): string {
    return `${from}->${to}`;
  }

  // ── Node operations ─────────────────────────────────────────────

  addNode(id: string, data: N): void {
    this.nodes.set(id, { id, data });
    if (!this.forward.has(id)) this.forward.set(id, new Set());
    if (!this.reverse.has(id)) this.reverse.set(id, new Set());
  }

  removeNode(id: string): void {
    // Remove all edges involving this node
    const successors = this.forward.get(id) ?? new Set();
    const predecessors = this.reverse.get(id) ?? new Set();

    for (const succ of successors) {
      this.reverse.get(succ)?.delete(id);
      this.edgeData.delete(this.edgeKey(id, succ));
    }
    for (const pred of predecessors) {
      this.forward.get(pred)?.delete(id);
      this.edgeData.delete(this.edgeKey(pred, id));
    }

    this.nodes.delete(id);
    this.forward.delete(id);
    this.reverse.delete(id);
  }

  getNode(id: string): DAGNode<N> | undefined {
    return this.nodes.get(id);
  }

  getAllNodes(): DAGNode<N>[] {
    return [...this.nodes.values()];
  }

  get nodeCount(): number {
    return this.nodes.size;
  }

  hasNode(id: string): boolean {
    return this.nodes.has(id);
  }

  // ── Edge operations ─────────────────────────────────────────────

  addEdge(from: string, to: string, data?: E): void {
    if (!this.nodes.has(from)) throw new Error(`Node "${from}" does not exist`);
    if (!this.nodes.has(to)) throw new Error(`Node "${to}" does not exist`);
    if (from === to) throw new Error(`Self-loops are not allowed: "${from}"`);

    this.forward.get(from)!.add(to);
    this.reverse.get(to)!.add(from);
    this.edgeData.set(this.edgeKey(from, to), { from, to, data });
  }

  removeEdge(from: string, to: string): void {
    this.forward.get(from)?.delete(to);
    this.reverse.get(to)?.delete(from);
    this.edgeData.delete(this.edgeKey(from, to));
  }

  hasEdge(from: string, to: string): boolean {
    return this.forward.get(from)?.has(to) ?? false;
  }

  getEdge(from: string, to: string): DAGEdge<E> | undefined {
    return this.edgeData.get(this.edgeKey(from, to));
  }

  getAllEdges(): DAGEdge<E>[] {
    return [...this.edgeData.values()];
  }

  get edgeCount(): number {
    return this.edgeData.size;
  }

  // ── Traversal ───────────────────────────────────────────────────

  getSuccessors(id: string): string[] {
    return [...(this.forward.get(id) ?? [])];
  }

  getPredecessors(id: string): string[] {
    return [...(this.reverse.get(id) ?? [])];
  }

  /** Nodes with no predecessors (entry points) */
  getRoots(): string[] {
    return [...this.nodes.keys()].filter(id => (this.reverse.get(id)?.size ?? 0) === 0);
  }

  /** Nodes with no successors (exit points) */
  getLeaves(): string[] {
    return [...this.nodes.keys()].filter(id => (this.forward.get(id)?.size ?? 0) === 0);
  }

  // ── Topological Sort (Kahn's Algorithm) ─────────────────────────

  topologicalSort(): string[] {
    const inDegree = new Map<string, number>();
    for (const id of this.nodes.keys()) {
      inDegree.set(id, this.reverse.get(id)?.size ?? 0);
    }

    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    const sorted: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      sorted.push(current);

      for (const succ of this.getSuccessors(current)) {
        const newDeg = (inDegree.get(succ) ?? 1) - 1;
        inDegree.set(succ, newDeg);
        if (newDeg === 0) queue.push(succ);
      }
    }

    if (sorted.length !== this.nodes.size) {
      // There's a cycle — find it for error reporting
      const remaining = [...this.nodes.keys()].filter(id => !sorted.includes(id));
      throw new DAGCycleError(remaining);
    }

    return sorted;
  }

  // ── Cycle Detection ─────────────────────────────────────────────

  hasCycle(): boolean {
    try {
      this.topologicalSort();
      return false;
    } catch {
      return true;
    }
  }

  // ── Parallel Execution Groups ───────────────────────────────────
  // Groups nodes into "waves" that can be executed in parallel.
  // Wave 0 = roots, Wave 1 = nodes whose deps are all in wave 0, etc.

  getParallelGroups(): string[][] {
    const sorted = this.topologicalSort();
    const waveOf = new Map<string, number>();

    for (const id of sorted) {
      const preds = this.getPredecessors(id);
      if (preds.length === 0) {
        waveOf.set(id, 0);
      } else {
        const maxPredWave = Math.max(...preds.map(p => waveOf.get(p) ?? 0));
        waveOf.set(id, maxPredWave + 1);
      }
    }

    const groups: string[][] = [];
    for (const [id, wave] of waveOf) {
      if (!groups[wave]) groups[wave] = [];
      groups[wave].push(id);
    }

    return groups;
  }

  // ── Serialization ───────────────────────────────────────────────

  toJSON(): { nodes: DAGNode<N>[]; edges: DAGEdge<E>[] } {
    return {
      nodes: this.getAllNodes(),
      edges: this.getAllEdges(),
    };
  }

  static fromJSON<N, E>(data: { nodes: DAGNode<N>[]; edges: DAGEdge<E>[] }): DAG<N, E> {
    const dag = new DAG<N, E>();
    for (const node of data.nodes) {
      dag.addNode(node.id, node.data);
    }
    for (const edge of data.edges) {
      dag.addEdge(edge.from, edge.to, edge.data);
    }
    return dag;
  }
}
