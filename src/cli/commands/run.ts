import chalk from "chalk";
import ora from "ora";
import { confirm } from "@inquirer/prompts";
import { PipelineRuntime } from "../../engine/runtime.js";
import { PipelineStore } from "../../persistence/index.js";
import { MCPClientManager } from "../../mcp/index.js";
import type { ExecutionOptions } from "../../types/execution.js";

interface RunOptions {
  var?: string[];
  dryRun?: boolean;
  concurrency: string;
}

export async function runCommand(pipelinePath: string, options: RunOptions): Promise<void> {
  console.log(chalk.bold.cyan("\n▶ Pipeline Builder — Run Mode\n"));

  const store = new PipelineStore(".");
  const spinner = ora("Loading pipeline...").start();

  try {
    const pipeline = await store.load(pipelinePath);
    spinner.succeed(`Loaded: ${pipeline.metadata.name} (v${pipeline.metadata.version})`);

    // Parse variables
    const variables: Record<string, unknown> = {};
    if (options.var) {
      for (const v of options.var) {
        const [key, ...rest] = v.split("=");
        variables[key] = rest.join("=");
      }
    }

    // Check required variables
    const missingVars = pipeline.variables
      .filter(v => v.required && !(v.name in variables) && v.default === undefined)
      .map(v => v.name);

    if (missingVars.length > 0) {
      console.log(chalk.red(`\nMissing required variables: ${missingVars.join(", ")}`));
      console.log(chalk.dim("Use --var key=value to provide them"));
      process.exit(1);
    }

    // Display pipeline summary
    console.log(chalk.dim(`\nNodes: ${pipeline.nodes.length} | Edges: ${pipeline.edges.length}`));
    if (options.dryRun) console.log(chalk.yellow("DRY RUN — no tools will be executed\n"));

    // Connect to MCP servers
    const mcpManager = new MCPClientManager();
    if (pipeline.mcpServers.length > 0 && !options.dryRun) {
      spinner.start("Connecting to MCP servers...");
      for (const server of pipeline.mcpServers) {
        try {
          await mcpManager.connect({
            name: server.name,
            command: server.command ?? "npx",
            args: server.args,
            env: server.env,
            transport: server.transport,
          });
        } catch (e) {
          console.log(chalk.yellow(`  Warning: Failed to connect to ${server.name}`));
        }
      }
      spinner.succeed("MCP servers connected");
    }

    // Set up runtime
    const runtime = new PipelineRuntime();

    runtime.onStep(async (nodeId, inputs) => {
      const node = pipeline.nodes.find(n => n.id === nodeId);
      if (!node?.tool) return { _skipped: true };

      const [server, tool] = node.tool.includes(":")
        ? node.tool.split(":", 2)
        : ["default", node.tool];

      const result = await mcpManager.callTool(server, tool, inputs);
      if (result.isError) throw new Error(result.errorMessage);
      return { result: result.content };
    });

    const execOptions: ExecutionOptions = {
      dryRun: options.dryRun,
      variables,
      concurrency: parseInt(options.concurrency, 10),
      onStepStart: (nodeId) => {
        const node = pipeline.nodes.find(n => n.id === nodeId);
        spinner.start(`Running: ${node?.name ?? nodeId}`);
      },
      onStepComplete: (nodeId) => {
        const node = pipeline.nodes.find(n => n.id === nodeId);
        spinner.succeed(`Done: ${node?.name ?? nodeId}`);
      },
      onStepFailed: (nodeId, error) => {
        const node = pipeline.nodes.find(n => n.id === nodeId);
        spinner.fail(`Failed: ${node?.name ?? nodeId} — ${error}`);
      },
      onHumanReview: async (nodeId, prompt) => {
        spinner.stop();
        const approved = await confirm({ message: prompt, default: true });
        return approved;
      },
    };

    // Execute
    console.log(chalk.bold("\n--- Execution Start ---\n"));
    const result = await runtime.execute(pipeline, execOptions);
    console.log(chalk.bold("\n--- Execution End ---\n"));

    // Summary
    const completed = [...result.nodes.values()].filter(n => n.status === "completed").length;
    const failed = [...result.nodes.values()].filter(n => n.status === "failed").length;
    const skipped = [...result.nodes.values()].filter(n => n.status === "skipped").length;

    console.log(chalk.bold(`Status: ${result.status === "completed" ? chalk.green("SUCCESS") : chalk.red("FAILED")}`));
    console.log(`  Completed: ${completed} | Failed: ${failed} | Skipped: ${skipped}`);

    // Cleanup
    await mcpManager.disconnectAll();

    if (result.status === "failed") process.exit(1);
  } catch (error) {
    spinner.fail("Execution failed");
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
