import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { PipelinePlugin } from "./plugin-api.js";
import type { ToolDefinition, ToolResult } from "../types/mcp.js";
import { createChildLogger } from "../utils/logger.js";
import { ToolNotFoundError } from "../utils/errors.js";

/**
 * Discovers, loads, and manages pipeline plugins.
 * Provides a unified tool registry across all loaded plugins.
 */
export class PluginLoader {
  private plugins = new Map<string, PipelinePlugin>();
  private logger = createChildLogger("PluginLoader");

  /**
   * Register a plugin programmatically.
   */
  async register(plugin: PipelinePlugin): Promise<void> {
    if (plugin.initialize) await plugin.initialize();
    this.plugins.set(plugin.name, plugin);
    this.logger.info(`Registered plugin: ${plugin.name}@${plugin.version} (${plugin.tools.length} tools)`);
  }

  /**
   * Discover and load plugins from node_modules.
   * Looks for packages matching: pipeline-builder-plugin-*
   */
  async discoverFromNodeModules(baseDir?: string): Promise<number> {
    const nodeModulesDir = join(baseDir ?? process.cwd(), "node_modules");
    if (!existsSync(nodeModulesDir)) return 0;

    let loaded = 0;

    try {
      const entries = await readdir(nodeModulesDir);
      const pluginDirs = entries.filter(e => e.startsWith("pipeline-builder-plugin-"));

      for (const dir of pluginDirs) {
        try {
          const modulePath = join(nodeModulesDir, dir);
          const mod = await import(modulePath);
          const plugin: PipelinePlugin = mod.default ?? mod;

          if (plugin.name && plugin.tools && typeof plugin.execute === "function") {
            await this.register(plugin);
            loaded++;
          }
        } catch (e) {
          this.logger.warn(`Failed to load plugin ${dir}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } catch {
      // node_modules not readable
    }

    return loaded;
  }

  /**
   * Get all tools from all loaded plugins.
   */
  getAllTools(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    for (const plugin of this.plugins.values()) {
      tools.push(...plugin.tools);
    }
    return tools;
  }

  /**
   * Find which plugin provides a given tool.
   */
  findPlugin(toolIdentifier: string): PipelinePlugin | undefined {
    const [serverName, toolName] = toolIdentifier.includes(":")
      ? toolIdentifier.split(":", 2)
      : [undefined, toolIdentifier];

    for (const plugin of this.plugins.values()) {
      if (serverName && plugin.name !== serverName) continue;
      if (plugin.tools.some(t => t.name === toolName)) return plugin;
    }
    return undefined;
  }

  /**
   * Execute a tool through its plugin.
   */
  async executeTool(toolIdentifier: string, input: Record<string, unknown>): Promise<ToolResult> {
    const plugin = this.findPlugin(toolIdentifier);
    if (!plugin) throw new ToolNotFoundError(toolIdentifier);

    const toolName = toolIdentifier.includes(":")
      ? toolIdentifier.split(":", 2)[1]
      : toolIdentifier;

    return plugin.execute(toolName, input);
  }

  /**
   * Check if a tool is provided by any loaded plugin.
   */
  hasTool(toolIdentifier: string): boolean {
    return this.findPlugin(toolIdentifier) !== undefined;
  }

  /**
   * List all loaded plugins.
   */
  listPlugins(): Array<{ name: string; version: string; toolCount: number }> {
    return [...this.plugins.values()].map(p => ({
      name: p.name,
      version: p.version,
      toolCount: p.tools.length,
    }));
  }

  /**
   * Cleanup all plugins.
   */
  async cleanup(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.cleanup) await plugin.cleanup();
    }
    this.plugins.clear();
  }
}
