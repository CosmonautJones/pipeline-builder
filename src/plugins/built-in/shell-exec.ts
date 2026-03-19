import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PipelinePlugin } from "../plugin-api.js";

const execFileAsync = promisify(execFile);

/**
 * Built-in shell execution plugin.
 * Handles "shell:exec" tool references — the universal fallback
 * for any pipeline step that just needs to run a command.
 */
export const shellExecPlugin: PipelinePlugin = {
  name: "shell",
  version: "1.0.0",
  tools: [
    {
      server: "shell",
      name: "exec",
      description: "Execute a shell command and return stdout/stderr",
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string", description: "The command to execute" },
          cwd: { type: "string", description: "Working directory (optional)" },
          timeout: { type: "number", description: "Timeout in ms (default: 300000)" },
        },
        required: ["command"],
      },
    },
  ],

  async execute(toolName, input) {
    if (toolName !== "exec") {
      return { content: null, isError: true, errorMessage: `Unknown tool: shell:${toolName}` };
    }

    const command = input.command as string;
    const cwd = input.cwd as string | undefined;
    const timeout = (input.timeout as number) ?? 300_000;

    try {
      // Split command into program + args for execFile (safer than exec)
      const parts = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [command];
      const program = parts[0];
      const args = parts.slice(1).map(a => a.replace(/^["']|["']$/g, ""));

      const { stdout, stderr } = await execFileAsync(program, args, {
        cwd,
        timeout,
        shell: true,
      });

      return {
        content: { stdout: stdout.trim(), stderr: stderr.trim() },
        isError: false,
      };
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; message?: string };
      return {
        content: { stdout: err.stdout ?? "", stderr: err.stderr ?? "" },
        isError: true,
        errorMessage: err.message ?? String(error),
      };
    }
  },
};
