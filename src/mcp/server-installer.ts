import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { McpServerConfig } from "../types/mcp.js";
import { createChildLogger } from "../utils/logger.js";

const execFileAsync = promisify(execFile);

/**
 * Handles dynamic installation and configuration of MCP servers.
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
   * Generate a server config from a package name.
   * Assumes the package exposes a stdio-based MCP server via npx.
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
   */
  static readonly KNOWN_SERVERS: Record<string, McpServerConfig> = {
    filesystem: {
      name: "filesystem",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem"],
      transport: "stdio",
    },
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
    fetch: {
      name: "fetch",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-fetch"],
      transport: "stdio",
    },
  };

  /**
   * Look up a well-known server for a given capability.
   */
  findServerForCapability(capability: string): McpServerConfig | undefined {
    const lower = capability.toLowerCase();
    const capabilityMap: Record<string, string> = {
      file: "filesystem",
      filesystem: "filesystem",
      read: "filesystem",
      write: "filesystem",
      git: "git",
      github: "github",
      "pull-request": "github",
      issue: "github",
      fetch: "fetch",
      http: "fetch",
      web: "fetch",
    };

    const serverKey = capabilityMap[lower];
    if (serverKey) {
      return MCPServerInstaller.KNOWN_SERVERS[serverKey];
    }
    return undefined;
  }
}
