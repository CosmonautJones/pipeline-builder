import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { McpServerConfig } from "../types/mcp.js";
import { createChildLogger } from "../utils/logger.js";

const execFileAsync = promisify(execFile);

/**
 * Handles discovery, installation, validation, and configuration of MCP servers.
 * This is the self-extension engine — it can find and install new capabilities.
 */
export class MCPServerInstaller {
  private logger = createChildLogger("MCPServerInstaller");

  /**
   * Install an npm-based MCP server package.
   */
  async installNpmPackage(packageName: string): Promise<void> {
    this.logger.info(`Installing MCP server package: ${packageName}`);
    try {
      await execFileAsync("npm", ["install", "-g", packageName], {
        timeout: 120_000,
      });
      this.logger.info(`Successfully installed ${packageName}`);
    } catch (error) {
      throw new Error(
        `Failed to install ${packageName}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Search npm registry for MCP server packages.
   * Returns package names that match the query.
   */
  async searchNpmRegistry(query: string): Promise<Array<{ name: string; description: string }>> {
    try {
      const { stdout } = await execFileAsync(
        "npm", ["search", query, "mcp-server", "--json", "--long"],
        { timeout: 30_000 },
      );
      const results = JSON.parse(stdout);
      if (!Array.isArray(results)) return [];
      return results
        .filter((r: { name?: string }) => r.name?.includes("mcp") || r.name?.includes("modelcontextprotocol"))
        .slice(0, 10)
        .map((r: { name: string; description?: string }) => ({
          name: r.name,
          description: r.description ?? "",
        }));
    } catch {
      this.logger.warn(`npm search failed for "${query}"`);
      return [];
    }
  }

  /**
   * Validate that a server config actually works by connecting and listing tools.
   * Returns the number of tools found, or -1 if connection failed.
   */
  async validateServer(config: McpServerConfig): Promise<{ valid: boolean; toolCount: number; error?: string }> {
    try {
      // Dynamically import to avoid circular deps
      const { MCPClientManager } = await import("./client-manager.js");
      const manager = new MCPClientManager();
      await manager.connect(config);
      const tools = manager.getAllTools();
      await manager.disconnectAll();
      return { valid: true, toolCount: tools.length };
    } catch (error) {
      return {
        valid: false,
        toolCount: -1,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Generate a server config from a package name.
   */
  configFromPackage(packageName: string, env?: Record<string, string>): McpServerConfig {
    return {
      name: packageName.replace(/^@/, "").replace(/\//g, "-"),
      command: "npx",
      args: ["-y", packageName],
      env: env ?? {},
      transport: "stdio",
    };
  }

  /**
   * Well-known MCP servers for common capabilities.
   * Expanded registry covering databases, cloud, messaging, dev tools, and more.
   */
  static readonly KNOWN_SERVERS: Record<string, McpServerConfig> = {
    // ── Filesystem & I/O ────────────────────────────────────────
    filesystem: {
      name: "filesystem",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem"],
      transport: "stdio",
    },
    fetch: {
      name: "fetch",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-fetch"],
      transport: "stdio",
    },
    memory: {
      name: "memory",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-memory"],
      transport: "stdio",
    },

    // ── Version Control ─────────────────────────────────────────
    git: {
      name: "git",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-git"],
      transport: "stdio",
    },
    github: {
      name: "github",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      transport: "stdio",
      env: { GITHUB_TOKEN: "" },
    },
    gitlab: {
      name: "gitlab",
      command: "npx",
      args: ["-y", "mcp-server-gitlab"],
      transport: "stdio",
      env: { GITLAB_TOKEN: "" },
    },

    // ── Databases ───────────────────────────────────────────────
    postgres: {
      name: "postgres",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-postgres"],
      transport: "stdio",
      env: { DATABASE_URL: "" },
    },
    sqlite: {
      name: "sqlite",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-sqlite"],
      transport: "stdio",
    },
    redis: {
      name: "redis",
      command: "npx",
      args: ["-y", "mcp-server-redis"],
      transport: "stdio",
    },
    mongodb: {
      name: "mongodb",
      command: "npx",
      args: ["-y", "mcp-server-mongodb"],
      transport: "stdio",
      env: { MONGODB_URI: "" },
    },

    // ── Cloud Providers ─────────────────────────────────────────
    aws: {
      name: "aws",
      command: "npx",
      args: ["-y", "mcp-server-aws"],
      transport: "stdio",
      env: { AWS_ACCESS_KEY_ID: "", AWS_SECRET_ACCESS_KEY: "", AWS_REGION: "us-east-1" },
    },

    // ── Containers & Orchestration ──────────────────────────────
    docker: {
      name: "docker",
      command: "npx",
      args: ["-y", "mcp-server-docker"],
      transport: "stdio",
    },
    kubernetes: {
      name: "kubernetes",
      command: "npx",
      args: ["-y", "kubernetes-mcp-server"],
      transport: "stdio",
    },

    // ── Messaging & Communication ───────────────────────────────
    slack: {
      name: "slack",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-slack"],
      transport: "stdio",
      env: { SLACK_BOT_TOKEN: "" },
    },

    // ── Search & Web ────────────────────────────────────────────
    "brave-search": {
      name: "brave-search",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-brave-search"],
      transport: "stdio",
      env: { BRAVE_API_KEY: "" },
    },

    // ── Browser Automation ──────────────────────────────────────
    puppeteer: {
      name: "puppeteer",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-puppeteer"],
      transport: "stdio",
    },
    playwright: {
      name: "playwright",
      command: "npx",
      args: ["-y", "@executeautomation/playwright-mcp-server"],
      transport: "stdio",
    },
  };

  /**
   * Capability-to-server mapping.
   * Maps natural language capabilities to known server keys.
   */
  static readonly CAPABILITY_MAP: Record<string, string> = {
    // Filesystem
    file: "filesystem", filesystem: "filesystem", read: "filesystem", write: "filesystem",
    // Network
    fetch: "fetch", http: "fetch", web: "fetch", api: "fetch", request: "fetch",
    // Version control
    git: "git", github: "github", gitlab: "gitlab",
    "pull-request": "github", issue: "github", pr: "github", repo: "github",
    // Databases
    postgres: "postgres", postgresql: "postgres", sql: "postgres", database: "postgres",
    sqlite: "sqlite", redis: "redis", mongodb: "mongodb", mongo: "mongodb",
    // Cloud
    aws: "aws", s3: "aws", lambda: "aws", ec2: "aws",
    // Containers
    docker: "docker", container: "docker", kubernetes: "kubernetes", k8s: "kubernetes",
    // Communication
    slack: "slack", message: "slack", notification: "slack",
    // Search
    search: "brave-search", "web-search": "brave-search",
    // Browser
    browser: "puppeteer", scrape: "puppeteer", playwright: "playwright",
    // Memory
    memory: "memory", cache: "memory", store: "memory",
  };

  /**
   * Look up a well-known server for a given capability.
   */
  findServerForCapability(capability: string): McpServerConfig | undefined {
    const lower = capability.toLowerCase();

    // Direct match
    const serverKey = MCPServerInstaller.CAPABILITY_MAP[lower];
    if (serverKey) {
      return MCPServerInstaller.KNOWN_SERVERS[serverKey];
    }

    // Fuzzy match — check if capability contains any known keyword
    for (const [keyword, key] of Object.entries(MCPServerInstaller.CAPABILITY_MAP)) {
      if (lower.includes(keyword)) {
        return MCPServerInstaller.KNOWN_SERVERS[key];
      }
    }

    return undefined;
  }

  /**
   * Find all servers that match a set of required connections.
   */
  findServersForConnections(connections: Array<{ system: string; connectionType: string }>): Map<string, McpServerConfig> {
    const result = new Map<string, McpServerConfig>();

    for (const conn of connections) {
      // Try system name first, then connection type
      const config = this.findServerForCapability(conn.system)
        ?? this.findServerForCapability(conn.connectionType);

      if (config && !result.has(config.name)) {
        result.set(config.name, config);
      }
    }

    return result;
  }

  /**
   * List all known server names.
   */
  listKnownServers(): string[] {
    return Object.keys(MCPServerInstaller.KNOWN_SERVERS);
  }
}
