import type { DAG } from "./graph.js";
import type { PipelineNode, PipelineEdge } from "../types/pipeline.js";

const NODE_ICONS: Record<string, string> = {
  trigger: ">>",
  action: "[]",
  condition: "<>",
  transform: "{}",
  "human-review": "!!",
  "sub-pipeline": "()",
  aggregator: "><",
};

/**
 * Generate an ASCII visualization of a pipeline DAG.
 *
 * Uses the parallel execution groups (waves) to lay out nodes
 * in columns, with connections shown between them.
 */
export function visualizeDAG(
  dag: DAG<PipelineNode, PipelineEdge>,
): string {
  const groups = dag.getParallelGroups();
  if (groups.length === 0) return "(empty pipeline)";

  const lines: string[] = [];

  // Build a layout: each wave is a column
  const waves: Array<Array<{ id: string; name: string; type: string }>> = [];

  for (const group of groups) {
    const wave: Array<{ id: string; name: string; type: string }> = [];
    for (const nodeId of group) {
      const node = dag.getNode(nodeId);
      if (node) {
        wave.push({
          id: node.data.id,
          name: node.data.name,
          type: node.data.type,
        });
      }
    }
    waves.push(wave);
  }

  // Determine max nodes in any wave (for height)
  const maxHeight = Math.max(...waves.map(w => w.length));

  // Header
  lines.push("Pipeline DAG:");
  lines.push("");

  // Render wave headers
  const colWidth = 22;
  const headerLine = waves.map((_, i) => `Wave ${i + 1}`.padEnd(colWidth)).join("");
  lines.push("  " + headerLine);
  lines.push("  " + waves.map(() => "─".repeat(colWidth - 2) + "  ").join(""));

  // Render each row
  for (let row = 0; row < maxHeight; row++) {
    const nodeLine = waves.map(wave => {
      if (row >= wave.length) return " ".repeat(colWidth);
      const node = wave[row];
      const icon = NODE_ICONS[node.type] ?? "??";
      const label = `${icon} ${truncate(node.name, colWidth - 6)}`;
      return label.padEnd(colWidth);
    }).join("");

    const idLine = waves.map(wave => {
      if (row >= wave.length) return " ".repeat(colWidth);
      return `   ${wave[row].id}`.padEnd(colWidth);
    }).join("");

    lines.push("  " + nodeLine);
    lines.push("  " + idLine);
    if (row < maxHeight - 1) lines.push(""); // spacing between rows
  }

  // Render edges
  lines.push("");
  lines.push("  Connections:");
  const edges = dag.getAllEdges();
  for (const edge of edges) {
    const fromNode = dag.getNode(edge.from);
    const toNode = dag.getNode(edge.to);
    const fromName = fromNode?.data.name ?? edge.from;
    const toName = toNode?.data.name ?? edge.to;
    const condition = edge.data?.condition ? ` [if: ${edge.data.condition}]` : "";
    lines.push(`    ${fromName} ──> ${toName}${condition}`);
  }

  // Summary
  lines.push("");
  lines.push(`  Nodes: ${dag.nodeCount} | Edges: ${dag.edgeCount} | Waves: ${waves.length}`);

  return lines.join("\n");
}

/**
 * Generate a compact single-line flow representation.
 * Good for quick overview in CLI output.
 */
export function visualizeFlow(
  dag: DAG<PipelineNode, PipelineEdge>,
): string {
  const groups = dag.getParallelGroups();
  if (groups.length === 0) return "(empty)";

  const parts: string[] = [];

  for (const group of groups) {
    const names = group.map(id => {
      const node = dag.getNode(id);
      return node?.data.name ?? id;
    });

    if (names.length === 1) {
      parts.push(`[${names[0]}]`);
    } else {
      parts.push(`[${names.join(" | ")}]`);
    }
  }

  return parts.join(" → ");
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}
