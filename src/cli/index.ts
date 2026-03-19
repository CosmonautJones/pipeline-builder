#!/usr/bin/env node
import { Command } from "commander";
import { planCommand } from "./commands/plan.js";
import { runCommand } from "./commands/run.js";
import { validateCommand } from "./commands/validate.js";
import { listCommand } from "./commands/list.js";
import { initCommand } from "./commands/init.js";
import { exportCommand } from "./commands/export.js";
import { visualizeCommand } from "./commands/visualize.js";

const program = new Command();

program
  .name("pb")
  .description("Universal Agentic Pipeline Builder — AI-designed workflow orchestration")
  .version("0.1.0");

program
  .command("plan")
  .description("Design a pipeline from a natural language goal")
  .argument("<goal>", "What you want the pipeline to accomplish")
  .option("-t, --template <id>", "Start from a template")
  .option("-o, --output <path>", "Output file path", "./pipeline.yaml")
  .option("--no-interactive", "Skip clarifying questions")
  .option("--dry-run", "Generate pipeline without executing")
  .option("-s, --subscription", "Subscription mode: generates instructions for Claude Code/Cursor instead of calling API")
  .option("--target <target>", "Subscription target: claude-code, cursor, or both", "both")
  .action(planCommand);

program
  .command("run")
  .description("Execute a pipeline definition")
  .argument("<pipeline>", "Path to pipeline YAML/JSON file")
  .option("-v, --var <key=value...>", "Pipeline variables")
  .option("--dry-run", "Simulate execution without running tools")
  .option("--concurrency <n>", "Max parallel steps", "5")
  .action(runCommand);

program
  .command("validate")
  .description("Validate a pipeline definition")
  .argument("<pipeline>", "Path to pipeline YAML/JSON file")
  .option("--strict", "Treat warnings as errors")
  .action(validateCommand);

program
  .command("list")
  .description("List templates and saved pipelines")
  .option("--templates", "Show available templates")
  .option("--saved", "Show saved pipelines")
  .action(listCommand);

program
  .command("init")
  .description("Initialize pipeline builder in a project")
  .option("-d, --dir <path>", "Directory for pipeline files", "./.pipelines")
  .action(initCommand);

program
  .command("visualize")
  .description("Visualize a pipeline's DAG structure")
  .argument("<pipeline>", "Path to pipeline YAML/JSON file")
  .option("-c, --compact", "Compact single-line flow view")
  .action(visualizeCommand);

program
  .command("export")
  .description("Export pipeline as Claude Code / Cursor configuration")
  .argument("<pipeline>", "Path to pipeline YAML/JSON file")
  .requiredOption("-t, --target <target>", "Export target: claude-md, cursor-rules, claude-hooks, or all")
  .option("-o, --output <path>", "Custom output path")
  .action(exportCommand);

program
  .command("serve")
  .description("Start pipeline-builder as an MCP server (for Claude Code / Cursor)")
  .action(async () => {
    const { startMCPServer } = await import("../integrations/mcp-server.js");
    await startMCPServer();
  });

program.parse();
