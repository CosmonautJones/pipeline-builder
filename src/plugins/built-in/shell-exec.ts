import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PipelinePlugin } from "../plugin-api.js";

const execFileAsync = promisify(execFile);

/** Default timeout for shell commands in milliseconds (5 minutes). */
const DEFAULT_SHELL_TIMEOUT_MS = 300_000;

/**
 * Parse a shell command string into an array of arguments.
 * Handles single quotes, double quotes (with backslash escapes), and unquoted tokens.
 */
function parseCommand(command: string): string[] {
  const args: string[] = [];
  let current = "";
  let i = 0;

  while (i < command.length) {
    const ch = command[i];

    if (ch === " " || ch === "\t") {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
      i++;
    } else if (ch === "'") {
      // Single-quoted: literal until closing quote (no escape handling)
      i++;
      while (i < command.length && command[i] !== "'") {
        current += command[i++];
      }
      i++; // skip closing quote
    } else if (ch === '"') {
      // Double-quoted: supports backslash escapes
      i++;
      while (i < command.length && command[i] !== '"') {
        if (command[i] === "\\" && i + 1 < command.length) {
          i++;
          current += command[i++];
        } else {
          current += command[i++];
        }
      }
      i++; // skip closing quote
    } else if (ch === "\\" && i + 1 < command.length) {
      // Backslash escape outside quotes
      i++;
      current += command[i++];
    } else {
      current += command[i++];
    }
  }

  if (current.length > 0) {
    args.push(current);
  }

  if (args.length === 0) {
    throw new Error("Empty command");
  }

  return args;
}

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
    const timeout = (input.timeout as number) ?? DEFAULT_SHELL_TIMEOUT_MS;

    try {
      // Split command into program + args for execFile (safer than exec)
      const parts = parseCommand(command);
      const program = parts[0];
      const args = parts.slice(1);

      const { stdout, stderr } = await execFileAsync(program, args, {
        cwd,
        timeout,
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
