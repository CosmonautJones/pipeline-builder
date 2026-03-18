import type { PipelineDefinition } from "../types/pipeline.js";
import { buildDAGFromPipeline } from "../dag/index.js";
import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";

/**
 * Generates Cursor Rules from a pipeline definition.
 *
 * Cursor uses `.cursor/rules/*.mdc` files (MDC = Markdown with metadata)
 * to configure agent behavior. Each rule file has frontmatter that defines
 * when it activates (globs, always, etc.) and markdown body with instructions.
 *
 * This export creates rule files that make Cursor's agent follow the
 * pipeline workflow when working on the project.
 *
 * Usage:
 *   import { exportCursorRules } from "@pipeline-builder/core";
 *   await exportCursorRules(pipeline, ".cursor/rules");
 */

interface CursorRule {
  filename: string;
  description: string;
  globs?: string;
  alwaysApply?: boolean;
  content: string;
}

export function generateCursorRules(pipeline: PipelineDefinition): CursorRule[] {
  const dag = buildDAGFromPipeline(pipeline);
  const groups = dag.getParallelGroups();
  const rules: CursorRule[] = [];

  // Rule 1: Master pipeline rule (always active)
  const masterContent = generateMasterRule(pipeline, groups);
  rules.push({
    filename: "pipeline-workflow.mdc",
    description: `Pipeline workflow for ${pipeline.metadata.name}`,
    alwaysApply: true,
    content: masterContent,
  });

  // Rule 2: Per-stage rules for complex nodes
  for (const node of pipeline.nodes) {
    if (node.type === "human-review") {
      rules.push({
        filename: `pipeline-review-${node.id}.mdc`,
        description: `Human review gate: ${node.name}`,
        alwaysApply: false,
        content: generateReviewRule(node, pipeline),
      });
    }

    if (node.type === "action" && node.tool) {
      const [, toolName] = node.tool.includes(":") ? node.tool.split(":", 2) : ["", node.tool];
      if (toolName === "exec" || toolName === "shell") {
        // Generate a rule for shell-based steps with specific commands
        rules.push({
          filename: `pipeline-step-${node.id}.mdc`,
          description: `Pipeline step: ${node.name}`,
          alwaysApply: false,
          content: generateStepRule(node, pipeline),
        });
      }
    }
  }

  // Rule 3: MCP configuration rule
  if (pipeline.mcpServers.length > 0) {
    rules.push({
      filename: "pipeline-mcp-servers.mdc",
      description: "Required MCP servers for pipeline",
      alwaysApply: true,
      content: generateMcpRule(pipeline),
    });
  }

  return rules;
}

function generateMasterRule(
  pipeline: PipelineDefinition,
  groups: string[][],
): string {
  const lines: string[] = [];

  lines.push(`# ${pipeline.metadata.name} — Pipeline Workflow`);
  lines.push("");
  if (pipeline.metadata.description) {
    lines.push(pipeline.metadata.description);
    lines.push("");
  }

  lines.push("## Workflow Stages");
  lines.push("");
  lines.push("Follow this execution order when performing project tasks:");
  lines.push("");

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const nodes = group.map(id => pipeline.nodes.find(n => n.id === id));

    for (const node of nodes) {
      if (!node) continue;
      const badge = node.type === "human-review" ? " ⚠️ REVIEW GATE" : "";
      lines.push(`### ${i + 1}. ${node.name}${badge}`);
      if (node.description) lines.push(node.description);

      if (node.type === "action" && node.toolInput) {
        const cmd = node.toolInput.command;
        if (typeof cmd === "string") {
          lines.push(`Run: \`${cmd}\``);
        }
      }

      if (node.type === "human-review") {
        lines.push(`**STOP and ask for approval**: ${node.humanReview?.prompt ?? "Review and approve before continuing"}`);
      }

      if (node.errorPolicy === "skip") {
        lines.push("_Non-blocking: continue even if this step fails._");
      }

      lines.push("");
    }

    if (group.length > 1) {
      lines.push(`> Steps ${group.join(", ")} can run in parallel.`);
      lines.push("");
    }
  }

  // Variables
  if (pipeline.variables.length > 0) {
    lines.push("## Variables");
    lines.push("");
    for (const v of pipeline.variables) {
      const req = v.required ? "**required**" : "optional";
      const def = v.default !== undefined ? `, default: \`${String(v.default)}\`` : "";
      lines.push(`- \`${v.name}\` (${v.type}, ${req}${def})`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function generateReviewRule(
  node: PipelineDefinition["nodes"][0],
  pipeline: PipelineDefinition,
): string {
  const lines: string[] = [];
  lines.push(`# Review Gate: ${node.name}`);
  lines.push("");
  lines.push("**This is a human review checkpoint in the pipeline.**");
  lines.push("");
  lines.push(node.humanReview?.prompt ?? "Pause and ask the user for approval before proceeding.");
  lines.push("");
  lines.push("Before asking for approval, ensure:");

  // Find predecessor nodes
  const predecessors = node.dependsOn;
  for (const predId of predecessors) {
    const pred = pipeline.nodes.find(n => n.id === predId);
    if (pred) {
      lines.push(`- [ ] **${pred.name}** has completed successfully`);
    }
  }

  lines.push("");
  lines.push("Do NOT proceed past this point without explicit user approval.");
  return lines.join("\n");
}

function generateStepRule(
  node: PipelineDefinition["nodes"][0],
  pipeline: PipelineDefinition,
): string {
  const lines: string[] = [];
  lines.push(`# Step: ${node.name}`);
  lines.push("");
  if (node.description) {
    lines.push(node.description);
    lines.push("");
  }

  if (node.toolInput?.command) {
    lines.push(`Command: \`${String(node.toolInput.command)}\``);
    lines.push("");
  }

  if (node.retry) {
    lines.push(`Retry policy: up to ${node.retry.maxAttempts} attempts, ${node.retry.backoffMs}ms backoff`);
  }

  if (node.errorPolicy === "skip") {
    lines.push("On failure: skip and continue (this step is non-blocking)");
  } else if (node.errorPolicy === "fail") {
    lines.push("On failure: stop the pipeline — this step is critical");
  }

  return lines.join("\n");
}

function generateMcpRule(pipeline: PipelineDefinition): string {
  const lines: string[] = [];
  lines.push("# Required MCP Servers");
  lines.push("");
  lines.push("This pipeline requires the following MCP servers to be configured:");
  lines.push("");

  for (const server of pipeline.mcpServers) {
    lines.push(`## ${server.name}`);
    lines.push(`- Command: \`${server.command ?? "npx"} ${server.args.join(" ")}\``);
    lines.push(`- Transport: ${server.transport}`);
    if (Object.keys(server.env).length > 0) {
      lines.push(`- Environment: ${Object.keys(server.env).join(", ")}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Write Cursor rule files to disk.
 */
export async function exportCursorRules(
  pipeline: PipelineDefinition,
  outputDir?: string,
): Promise<string[]> {
  const dir = outputDir ?? ".cursor/rules";
  await mkdir(dir, { recursive: true });

  const rules = generateCursorRules(pipeline);
  const paths: string[] = [];

  for (const rule of rules) {
    // Build MDC frontmatter
    const frontmatter: string[] = ["---"];
    frontmatter.push(`description: ${rule.description}`);
    if (rule.globs) frontmatter.push(`globs: ${rule.globs}`);
    if (rule.alwaysApply) frontmatter.push("alwaysApply: true");
    frontmatter.push("---");

    const content = frontmatter.join("\n") + "\n\n" + rule.content;
    const filepath = join(dir, rule.filename);
    await writeFile(filepath, content, "utf-8");
    paths.push(filepath);
  }

  return paths;
}
