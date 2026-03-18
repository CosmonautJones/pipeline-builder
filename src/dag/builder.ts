import type { PipelineDefinition, PipelineNode, PipelineEdge } from "../types/pipeline.js";
import { DAG } from "./graph.js";

/**
 * Builds a DAG from a PipelineDefinition.
 * Handles both explicit edges and implicit dependsOn declarations.
 */
export function buildDAGFromPipeline(
  pipeline: PipelineDefinition,
): DAG<PipelineNode, PipelineEdge> {
  const dag = new DAG<PipelineNode, PipelineEdge>();

  // Add all nodes
  for (const node of pipeline.nodes) {
    dag.addNode(node.id, node);
  }

  // Add explicit edges
  for (const edge of pipeline.edges) {
    dag.addEdge(edge.from, edge.to, edge);
  }

  // Add implicit edges from dependsOn
  for (const node of pipeline.nodes) {
    for (const depId of node.dependsOn) {
      if (!dag.hasEdge(depId, node.id)) {
        dag.addEdge(depId, node.id, { from: depId, to: node.id });
      }
    }
  }

  return dag;
}
