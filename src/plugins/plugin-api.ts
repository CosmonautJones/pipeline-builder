import type { ToolDefinition, ToolResult } from "../types/mcp.js";

/**
 * Plugin interface for extending pipeline-builder with custom tools.
 *
 * Plugins provide tools that pipeline nodes can reference.
 * They are discovered from node_modules (pipeline-builder-plugin-*)
 * or registered programmatically.
 *
 * Example plugin:
 * ```typescript
 * export default {
 *   name: "my-plugin",
 *   version: "1.0.0",
 *   tools: [{ server: "my-plugin", name: "do-thing", description: "...", inputSchema: {} }],
 *   async execute(toolName, input) { return { content: "done", isError: false }; },
 * }
 * ```
 */
export interface PipelinePlugin {
  /** Unique plugin name */
  name: string;
  /** Semver version */
  version: string;
  /** Tools this plugin provides */
  tools: ToolDefinition[];
  /** Execute a tool by name */
  execute(toolName: string, input: Record<string, unknown>): Promise<ToolResult>;
  /** Optional: called when the plugin is loaded */
  initialize?(): Promise<void>;
  /** Optional: called when the plugin is unloaded */
  cleanup?(): Promise<void>;
}
