import type { PipelineDefinition } from "../types/pipeline.js";
import { buildDAGFromPipeline } from "../dag/index.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Generates a CLAUDE.md file from a pipeline definition.
 *
 * CLAUDE.md is the project instruction file that Claude Code reads on startup.
 * This export translates pipeline structure into instructions that guide Claude
 * Code's behavior — effectively making the pipeline definition the "rules"
 * for how the AI assistant operates on this project.
 *
 * Usage:
 *   import { exportClaudeMd } from "@pipeline-builder/core";
 *   await exportClaudeMd(pipeline, "./CLAUDE.md");
 */
export function generateClaudeMd(
  pipeline: PipelineDefinition,
  options?: {
    projectName?: string;
    additionalInstructions?: string;
    includeVariables?: boolean;
  },
): string {
  const dag = buildDAGFromPipeline(pipeline);
  const groups = dag.getParallelGroups();
  const roots = dag.getRoots();
  const leaves = dag.getLeaves();

  const sections: string[] = [];

  // Header
  sections.push(`# ${options?.projectName ?? pipeline.metadata.name}`);
  sections.push("");
  if (pipeline.metadata.description) {
    sections.push(pipeline.metadata.description);
    sections.push("");
  }

  // Pipeline overview
  sections.push("## Pipeline Architecture");
  sections.push("");
  sections.push(`This project uses an automated pipeline with ${pipeline.nodes.length} stages and ${groups.length} execution waves.`);
  sections.push("");

  // Execution order as instructions
  sections.push("### Execution Order");
  sections.push("");
  sections.push("When working on this project, follow this workflow order:");
  sections.push("");
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const nodeNames = group.map(id => {
      const node = pipeline.nodes.find(n => n.id === id);
      return node ? `**${node.name}** (\`${id}\`)` : id;
    });

    if (group.length === 1) {
      sections.push(`${i + 1}. ${nodeNames[0]}`);
    } else {
      sections.push(`${i + 1}. _Parallel:_ ${nodeNames.join(", ")}`);
    }
  }
  sections.push("");

  // Node details as instructions
  sections.push("### Stage Details");
  sections.push("");
  for (const node of pipeline.nodes) {
    sections.push(`#### ${node.name} (\`${node.id}\`)`);
    sections.push("");
    if (node.description) sections.push(node.description);

    if (node.type === "action" && node.tool) {
      sections.push(`- **Tool**: \`${node.tool}\``);
    }
    if (node.type === "human-review") {
      sections.push(`- **IMPORTANT**: This is a human review checkpoint. ${node.humanReview?.prompt ?? "Pause and ask for approval before proceeding."}`);
    }
    if (node.type === "condition") {
      sections.push(`- **Condition**: Only proceed if \`${node.condition}\``);
    }
    if (node.dependsOn.length > 0) {
      sections.push(`- **Depends on**: ${node.dependsOn.join(", ")}`);
    }
    if (node.retry) {
      sections.push(`- **Retry**: Up to ${node.retry.maxAttempts} attempts with ${node.retry.backoffMs}ms backoff`);
    }
    if (node.errorPolicy === "skip") {
      sections.push(`- **On failure**: Skip and continue (non-blocking)`);
    }
    sections.push("");
  }

  // Variables and secrets
  if (options?.includeVariables !== false && pipeline.variables.length > 0) {
    sections.push("## Configuration");
    sections.push("");
    sections.push("Required variables:");
    sections.push("");
    for (const v of pipeline.variables) {
      const req = v.required ? " **(required)**" : "";
      const def = v.default !== undefined ? ` (default: \`${String(v.default)}\`)` : "";
      sections.push(`- \`${v.name}\` (${v.type})${req}${def}: ${v.description ?? ""}`);
    }
    sections.push("");
  }

  if (pipeline.secrets.length > 0) {
    sections.push("## Required Secrets");
    sections.push("");
    sections.push("The following secrets must be configured (never commit these):");
    sections.push("");
    for (const s of pipeline.secrets) {
      sections.push(`- \`${s}\``);
    }
    sections.push("");
  }

  // MCP servers
  if (pipeline.mcpServers.length > 0) {
    sections.push("## MCP Servers");
    sections.push("");
    sections.push("This pipeline requires the following MCP servers:");
    sections.push("");
    for (const s of pipeline.mcpServers) {
      sections.push(`- **${s.name}**: \`${s.command ?? ""} ${s.args.join(" ")}\``);
    }
    sections.push("");
  }

  // Pipeline rules
  sections.push("## Pipeline Rules");
  sections.push("");
  sections.push("- Always run stages in the order specified above");
  sections.push("- Parallel stages can run concurrently when their dependencies are met");
  sections.push("- Human review checkpoints require explicit approval before continuing");
  sections.push("- On failure, check the retry policy — some stages auto-retry");
  sections.push(`- Pipeline trigger: \`${pipeline.trigger.type}\``);
  sections.push("");

  // Additional instructions
  if (options?.additionalInstructions) {
    sections.push("## Additional Instructions");
    sections.push("");
    sections.push(options.additionalInstructions);
    sections.push("");
  }

  return sections.join("\n");
}

/**
 * Write CLAUDE.md to disk.
 */
export async function exportClaudeMd(
  pipeline: PipelineDefinition,
  outputPath?: string,
  options?: Parameters<typeof generateClaudeMd>[1],
): Promise<string> {
  const content = generateClaudeMd(pipeline, options);
  const filepath = outputPath ?? "CLAUDE.md";
  await writeFile(filepath, content, "utf-8");
  return filepath;
}
