import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpServerConfig, ToolDefinition, ToolResult } from "../types/mcp.js";
import { createChildLogger } from "../utils/logger.js";
import { MCPConnectionError, ToolNotFoundError } from "../utils/errors.js";

interface ConnectedServer {
  config: McpServerConfig;
  client: Client;
  tools: ToolDefinition[];
}

/**
 * Manages connections to MCP servers and provides a unified tool registry.
 */
export class MCPClientManager {
  private servers = new Map<string, ConnectedServer>();
  private logger = createChildLogger("MCPClientManager");

  /**
   * Connect to an MCP server.
   */
  async connect(config: McpServerConfig): Promise<void> {
    if (this.servers.has(config.name)) {
      this.logger.warn(`Already connected to "${config.name}", reconnecting`);
      await this.disconnect(config.name);
    }

    try {
      const client = new Client({
        name: "pipeline-builder",
        version: "0.1.0",
      });

      if (config.transport === "stdio") {
        const transport = new StdioClientTransport({
          command: config.command,
          args: config.args,
          env: config.env ? MCPClientManager.buildSafeEnv(config.env) : undefined,
        });
        await client.connect(transport);
      } else {
        throw new MCPConnectionError(config.name, `Unsupported transport: ${config.transport}`);
      }

      // Discover tools
      const toolsResponse = await client.listTools();
      const tools: ToolDefinition[] = (toolsResponse.tools ?? []).map(t => ({
        server: config.name,
        name: t.name,
        description: t.description ?? "",
        inputSchema: t.inputSchema as Record<string, unknown>,
      }));

      this.servers.set(config.name, { config, client, tools });
      this.logger.info(`Connected to "${config.name}" — ${tools.length} tools available`);
    } catch (error) {
      if (error instanceof MCPConnectionError) throw error;
      throw new MCPConnectionError(
        config.name,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Disconnect from an MCP server.
   */
  async disconnect(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (server) {
      try {
        await server.client.close();
      } catch {
        // Ignore close errors
      }
      this.servers.delete(name);
      this.logger.info(`Disconnected from "${name}"`);
    }
  }

  /**
   * Disconnect from all servers.
   */
  async disconnectAll(): Promise<void> {
    const names = [...this.servers.keys()];
    await Promise.all(names.map(n => this.disconnect(n)));
  }

  /**
   * Call a tool on a specific server.
   */
  async callTool(
    server: string,
    tool: string,
    input: Record<string, unknown>,
  ): Promise<ToolResult> {
    const conn = this.servers.get(server);
    if (!conn) {
      throw new MCPConnectionError(server, "Not connected");
    }

    try {
      const result = await conn.client.callTool({ name: tool, arguments: input });
      const isError = Boolean(result.isError);

      return {
        content: result.content,
        isError,
        errorMessage: isError ? JSON.stringify(result.content) : undefined,
      };
    } catch (error) {
      return {
        content: null,
        isError: true,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ── Tool Registry ───────────────────────────────────────────────

  /**
   * Get all discovered tools across all connected servers.
   */
  getAllTools(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    for (const server of this.servers.values()) {
      tools.push(...server.tools);
    }
    return tools;
  }

  /**
   * Find a specific tool by "server:tool_name" identifier.
   */
  findTool(identifier: string): ToolDefinition | undefined {
    const [serverName, toolName] = identifier.includes(":")
      ? identifier.split(":", 2)
      : [undefined, identifier];

    for (const server of this.servers.values()) {
      if (serverName && server.config.name !== serverName) continue;
      const tool = server.tools.find(t => t.name === toolName);
      if (tool) return tool;
    }
    return undefined;
  }

  /**
   * Search tools by keyword in name or description.
   */
  searchTools(query: string): ToolDefinition[] {
    const lower = query.toLowerCase();
    return this.getAllTools().filter(t =>
      t.name.toLowerCase().includes(lower) ||
      t.description.toLowerCase().includes(lower)
    );
  }

  /**
   * Build a safe environment for MCP server subprocesses.
   * Only inherits essential system vars from process.env, then overlays user config.
   * Prevents user-provided env from overriding sensitive vars like PATH manipulation attacks.
   */
  private static readonly SAFE_INHERIT_VARS = [
    "PATH", "HOME", "USER", "SHELL", "LANG", "TERM",
    "NODE_ENV", "TMPDIR", "TMP", "TEMP",
  ];

  private static buildSafeEnv(configEnv: Record<string, string>): Record<string, string> {
    const env: Record<string, string> = {};
    for (const key of MCPClientManager.SAFE_INHERIT_VARS) {
      if (process.env[key]) {
        env[key] = process.env[key] as string;
      }
    }
    // User-provided vars are overlaid but cannot override inherited system vars
    for (const [key, value] of Object.entries(configEnv)) {
      if (!MCPClientManager.SAFE_INHERIT_VARS.includes(key)) {
        env[key] = value;
      }
    }
    return env;
  }

  /**
   * Get list of connected server names.
   */
  listConnected(): string[] {
    return [...this.servers.keys()];
  }

  /**
   * Refresh tools from a specific server.
   */
  async refreshTools(serverName: string): Promise<void> {
    const server = this.servers.get(serverName);
    if (!server) return;

    const toolsResponse = await server.client.listTools();
    server.tools = (toolsResponse.tools ?? []).map(t => ({
      server: serverName,
      name: t.name,
      description: t.description ?? "",
      inputSchema: t.inputSchema as Record<string, unknown>,
    }));
  }
}
