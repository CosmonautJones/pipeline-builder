import { describe, it, expect } from "vitest";
import { PluginLoader } from "../../../src/plugins/plugin-loader.js";
import { shellExecPlugin } from "../../../src/plugins/built-in/shell-exec.js";
import type { PipelinePlugin } from "../../../src/plugins/plugin-api.js";

describe("PluginLoader", () => {
  it("should register and list plugins", async () => {
    const loader = new PluginLoader();
    await loader.register(shellExecPlugin);

    const plugins = loader.listPlugins();
    expect(plugins.length).toBe(1);
    expect(plugins[0].name).toBe("shell");
    expect(plugins[0].toolCount).toBe(1);
  });

  it("should expose tools from registered plugins", async () => {
    const loader = new PluginLoader();
    await loader.register(shellExecPlugin);

    const tools = loader.getAllTools();
    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe("exec");
    expect(tools[0].server).toBe("shell");
  });

  it("should find plugin by tool identifier", async () => {
    const loader = new PluginLoader();
    await loader.register(shellExecPlugin);

    expect(loader.hasTool("shell:exec")).toBe(true);
    expect(loader.hasTool("shell:nonexistent")).toBe(false);
    expect(loader.hasTool("other:exec")).toBe(false);
  });

  it("should execute tools through plugins", async () => {
    const loader = new PluginLoader();
    await loader.register(shellExecPlugin);

    const result = await loader.executeTool("shell:exec", { command: "echo hello" });
    expect(result.isError).toBe(false);
    expect((result.content as { stdout: string }).stdout).toContain("hello");
  });

  it("should throw on unknown tool", async () => {
    const loader = new PluginLoader();
    await expect(loader.executeTool("unknown:tool", {})).rejects.toThrow("Tool not found");
  });

  it("should support custom plugins", async () => {
    const customPlugin: PipelinePlugin = {
      name: "custom",
      version: "1.0.0",
      tools: [
        { server: "custom", name: "greet", description: "Say hello", inputSchema: {} },
      ],
      async execute(toolName, input) {
        return { content: `Hello ${input.name}!`, isError: false };
      },
    };

    const loader = new PluginLoader();
    await loader.register(customPlugin);

    expect(loader.hasTool("custom:greet")).toBe(true);
    const result = await loader.executeTool("custom:greet", { name: "World" });
    expect(result.content).toBe("Hello World!");
  });

  it("should cleanup plugins", async () => {
    let cleaned = false;
    const plugin: PipelinePlugin = {
      name: "test",
      version: "1.0.0",
      tools: [],
      async execute() { return { content: null, isError: false }; },
      async cleanup() { cleaned = true; },
    };

    const loader = new PluginLoader();
    await loader.register(plugin);
    await loader.cleanup();

    expect(cleaned).toBe(true);
    expect(loader.listPlugins().length).toBe(0);
  });
});
