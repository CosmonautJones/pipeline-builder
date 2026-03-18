import type { PipelineDefinition } from "../types/pipeline.js";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

/**
 * Generates Claude Code hooks configuration from a pipeline definition.
 *
 * Claude Code hooks are shell commands that run in response to events:
 *   - PreToolUse: Before a tool is invoked
 *   - PostToolUse: After a tool completes
 *   - Notification: When Claude sends a notification
 *   - Stop: When Claude stops generating
 *   - SubagentStop: When a subagent completes
 *
 * This maps pipeline stages to hooks — e.g., a "validate" node becomes
 * a PreToolUse hook that runs before git commits, a "test" node becomes
 * a PostToolUse hook that runs after file edits, etc.
 *
 * Usage:
 *   import { exportClaudeCodeHooks } from "@pipeline-builder/core";
 *   await exportClaudeCodeHooks(pipeline, ".claude/settings.json");
 */

export interface ClaudeCodeHook {
  matcher: string;
  hooks: Array<{
    type: "command";
    command: string;
  }>;
}

export interface ClaudeCodeSettings {
  hooks?: {
    PreToolUse?: ClaudeCodeHook[];
    PostToolUse?: ClaudeCodeHook[];
    Notification?: ClaudeCodeHook[];
    Stop?: ClaudeCodeHook[];
    SubagentStop?: ClaudeCodeHook[];
  };
  mcpServers?: Record<string, {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }>;
  permissions?: {
    allow?: string[];
    deny?: string[];
  };
}

/**
 * Analyzes a pipeline and generates appropriate Claude Code hooks.
 */
export function generateClaudeCodeHooks(pipeline: PipelineDefinition): ClaudeCodeSettings {
  const settings: ClaudeCodeSettings = {
    hooks: {},
    mcpServers: {},
  };

  const preToolUse: ClaudeCodeHook[] = [];
  const postToolUse: ClaudeCodeHook[] = [];
  const stopHooks: ClaudeCodeHook[] = [];

  for (const node of pipeline.nodes) {
    // Map pipeline nodes to hooks based on their role
    if (node.type !== "action" || !node.toolInput?.command) continue;
    const command = String(node.toolInput.command);

    // Detect validation/lint nodes → PreToolUse on Write/Edit (run before changes are saved)
    if (isValidationStep(node)) {
      preToolUse.push({
        matcher: "Write|Edit",
        hooks: [{
          type: "command",
          command: wrapCommand(command, node.id),
        }],
      });
    }

    // Detect test nodes → PostToolUse on Write/Edit (run after changes)
    if (isTestStep(node)) {
      postToolUse.push({
        matcher: "Write|Edit",
        hooks: [{
          type: "command",
          command: wrapCommand(command, node.id),
        }],
      });
    }

    // Detect build nodes → Stop hook (run when Claude finishes a task)
    if (isBuildStep(node)) {
      stopHooks.push({
        matcher: ".*",
        hooks: [{
          type: "command",
          command: wrapCommand(command, node.id),
        }],
      });
    }

    // Detect deploy nodes → requires explicit trigger, so PostToolUse on Bash with git push
    if (isDeployStep(node)) {
      preToolUse.push({
        matcher: "Bash",
        hooks: [{
          type: "command",
          command: wrapDeployGuard(command, node.id),
        }],
      });
    }
  }

  if (preToolUse.length > 0) settings.hooks!.PreToolUse = preToolUse;
  if (postToolUse.length > 0) settings.hooks!.PostToolUse = postToolUse;
  if (stopHooks.length > 0) settings.hooks!.Stop = stopHooks;

  // Add pipeline-builder as an MCP server
  settings.mcpServers!["pipeline-builder"] = {
    command: "npx",
    args: ["tsx", "src/integrations/mcp-server.ts"],
  };

  // Add MCP servers from pipeline definition
  for (const server of pipeline.mcpServers) {
    settings.mcpServers![server.name] = {
      command: server.command ?? "npx",
      args: server.args,
      env: Object.keys(server.env).length > 0 ? server.env : undefined,
    };
  }

  return settings;
}

/**
 * Export hooks to a Claude Code settings file.
 * Merges with existing settings if the file exists.
 */
export async function exportClaudeCodeHooks(
  pipeline: PipelineDefinition,
  outputPath?: string,
): Promise<string> {
  const filepath = outputPath ?? ".claude/settings.json";
  const generated = generateClaudeCodeHooks(pipeline);

  // Merge with existing settings
  let existing: ClaudeCodeSettings = {};
  if (existsSync(filepath)) {
    try {
      const content = await readFile(filepath, "utf-8");
      existing = JSON.parse(content);
    } catch {
      // Start fresh if file is malformed
    }
  }

  const merged: ClaudeCodeSettings = {
    ...existing,
    hooks: {
      ...existing.hooks,
      PreToolUse: mergeHookArrays(existing.hooks?.PreToolUse, generated.hooks?.PreToolUse),
      PostToolUse: mergeHookArrays(existing.hooks?.PostToolUse, generated.hooks?.PostToolUse),
      Stop: mergeHookArrays(existing.hooks?.Stop, generated.hooks?.Stop),
    },
    mcpServers: {
      ...existing.mcpServers,
      ...generated.mcpServers,
    },
  };

  // Clean up empty hook arrays
  if (merged.hooks) {
    for (const [key, value] of Object.entries(merged.hooks)) {
      if (Array.isArray(value) && value.length === 0) {
        delete (merged.hooks as Record<string, unknown>)[key];
      }
    }
    if (Object.keys(merged.hooks).length === 0) delete merged.hooks;
  }

  await writeFile(filepath, JSON.stringify(merged, null, 2), "utf-8");
  return filepath;
}

// ── Helpers ─────────────────────────────────────────────────────────

function isValidationStep(node: PipelineDefinition["nodes"][0]): boolean {
  const id = node.id.toLowerCase();
  const name = node.name.toLowerCase();
  const cmd = String(node.toolInput?.command ?? "").toLowerCase();
  return (
    id.includes("lint") || id.includes("validate") || id.includes("check") ||
    name.includes("lint") || name.includes("validate") || name.includes("type check") ||
    cmd.includes("lint") || cmd.includes("eslint") || cmd.includes("prettier") ||
    cmd.includes("tsc --noEmit") || cmd.includes("typecheck")
  );
}

function isTestStep(node: PipelineDefinition["nodes"][0]): boolean {
  const id = node.id.toLowerCase();
  const name = node.name.toLowerCase();
  const cmd = String(node.toolInput?.command ?? "").toLowerCase();
  return (
    id.includes("test") || name.includes("test") ||
    cmd.includes("test") || cmd.includes("vitest") || cmd.includes("jest") || cmd.includes("pytest")
  );
}

function isBuildStep(node: PipelineDefinition["nodes"][0]): boolean {
  const id = node.id.toLowerCase();
  const name = node.name.toLowerCase();
  const cmd = String(node.toolInput?.command ?? "").toLowerCase();
  return (
    (id.includes("build") && !id.includes("docker")) ||
    (name.includes("build") && !name.includes("docker")) ||
    cmd.includes("npm run build") || cmd.includes("tsc")
  );
}

function isDeployStep(node: PipelineDefinition["nodes"][0]): boolean {
  const id = node.id.toLowerCase();
  const name = node.name.toLowerCase();
  return id.includes("deploy") || name.includes("deploy");
}

function wrapCommand(command: string, nodeId: string): string {
  // Wrap command with a descriptive echo for traceability
  return `echo "[pipeline:${nodeId}]" && ${command}`;
}

function wrapDeployGuard(command: string, nodeId: string): string {
  // Deploy commands get a guard that only triggers on push-related bash commands
  return `if echo "$TOOL_INPUT" | grep -q "push"; then echo "[pipeline:${nodeId}] Deploy guard triggered" && ${command}; fi`;
}

function mergeHookArrays(
  existing?: ClaudeCodeHook[],
  generated?: ClaudeCodeHook[],
): ClaudeCodeHook[] {
  const result = [...(existing ?? [])];

  for (const hook of generated ?? []) {
    // Don't duplicate hooks with the same matcher and command
    const isDuplicate = result.some(
      r => r.matcher === hook.matcher &&
           r.hooks.some(h => hook.hooks.some(g => g.command === h.command))
    );
    if (!isDuplicate) {
      result.push(hook);
    }
  }

  return result;
}
