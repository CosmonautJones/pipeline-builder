import type { PipelineDefinition } from "../types/pipeline.js";
import type { DAG } from "./graph.js";
import type { PipelineNode, PipelineEdge } from "../types/pipeline.js";

export interface DAGValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validates a pipeline DAG for structural correctness.
 */
export function validatePipelineDAG(
  dag: DAG<PipelineNode, PipelineEdge>,
  pipeline: PipelineDefinition,
): DAGValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Check for cycles
  if (dag.hasCycle()) {
    errors.push("Pipeline contains a cycle — execution order cannot be determined");
  }

  // 2. Check for orphaned nodes (no edges in or out, not a root/leaf)
  const roots = dag.getRoots();
  const leaves = dag.getLeaves();
  if (roots.length === 0) {
    errors.push("Pipeline has no entry points (root nodes)");
  }
  if (leaves.length === 0 && dag.nodeCount > 0) {
    errors.push("Pipeline has no exit points (leaf nodes)");
  }

  // 3. Validate node references in edges
  for (const edge of pipeline.edges) {
    if (!dag.hasNode(edge.from)) {
      errors.push(`Edge references non-existent source node: "${edge.from}"`);
    }
    if (!dag.hasNode(edge.to)) {
      errors.push(`Edge references non-existent target node: "${edge.to}"`);
    }
  }

  // 4. Validate tool references
  for (const node of pipeline.nodes) {
    if (node.type === "action" && !node.tool) {
      errors.push(`Action node "${node.id}" has no tool specified`);
    }
    if (node.type === "human-review" && !node.humanReview) {
      warnings.push(`Human-review node "${node.id}" has no review configuration`);
    }
    if (node.type === "sub-pipeline" && !node.subPipelineRef) {
      errors.push(`Sub-pipeline node "${node.id}" has no pipeline reference`);
    }
    if (node.type === "condition" && !node.condition) {
      errors.push(`Condition node "${node.id}" has no condition expression`);
    }
  }

  // 5. Check for duplicate node IDs
  const nodeIds = pipeline.nodes.map(n => n.id);
  const duplicateIds = nodeIds.filter((id, i) => nodeIds.indexOf(id) !== i);
  if (duplicateIds.length > 0) {
    errors.push(`Duplicate node IDs: ${[...new Set(duplicateIds)].join(", ")}`);
  }

  // 6. Check input mappings reference valid nodes
  for (const node of pipeline.nodes) {
    for (const [, mapping] of Object.entries(node.inputMappings)) {
      if (mapping.startsWith("nodes.")) {
        const refNodeId = mapping.split(".")[1];
        if (!dag.hasNode(refNodeId)) {
          errors.push(`Node "${node.id}" input mapping references non-existent node: "${refNodeId}"`);
        }
      }
    }
  }

  // 7. Warn about nodes with no incoming edges that aren't triggers
  for (const rootId of roots) {
    const rootNode = dag.getNode(rootId);
    if (rootNode && rootNode.data.type !== "trigger" && roots.length > 1) {
      warnings.push(`Node "${rootId}" has no dependencies — is this intentional?`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
