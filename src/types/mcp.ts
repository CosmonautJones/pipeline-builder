// ── MCP Server Configuration ────────────────────────────────────────

export interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  transport: "stdio" | "streamable-http";
  url?: string;
  autoInstall?: boolean;
}

// ── Tool Definition (discovered from MCP servers) ───────────────────

export interface ToolDefinition {
  server: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnly?: boolean;
    destructive?: boolean;
    idempotent?: boolean;
  };
}

// ── Tool Invocation ─────────────────────────────────────────────────

export interface ToolInvocation {
  server: string;
  tool: string;
  input: Record<string, unknown>;
}

// ── Tool Result ─────────────────────────────────────────────────────

export interface ToolResult {
  content: unknown;
  isError: boolean;
  errorMessage?: string;
}
