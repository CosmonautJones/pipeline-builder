import chalk from "chalk";
import { PipelineStore } from "../../persistence/index.js";
import { exportClaudeMd } from "../../integrations/claude-md-export.js";
import { exportCursorRules } from "../../integrations/cursor-rules-export.js";
import { exportClaudeCodeHooks } from "../../integrations/claude-code-hooks.js";

interface ExportOptions {
  target: string;
  output?: string;
}

export async function exportCommand(pipelinePath: string, options: ExportOptions): Promise<void> {
  console.log(chalk.bold.cyan("\n📦 Pipeline Builder — Export\n"));

  const store = new PipelineStore(".");

  try {
    const pipeline = await store.load(pipelinePath);
    console.log(`Pipeline: ${chalk.bold(pipeline.metadata.name)} (v${pipeline.metadata.version})\n`);

    const target = options.target;
    const targets = target === "all"
      ? ["claude-md", "cursor-rules", "claude-hooks"]
      : [target];

    for (const t of targets) {
      switch (t) {
        case "claude-md": {
          const path = await exportClaudeMd(pipeline, options.output ?? "CLAUDE.md");
          console.log(chalk.green(`✓ CLAUDE.md exported to: ${path}`));
          console.log(chalk.dim("  Claude Code will read this on startup to understand your pipeline\n"));
          break;
        }

        case "cursor-rules": {
          const paths = await exportCursorRules(pipeline, options.output ?? ".cursor/rules");
          console.log(chalk.green(`✓ Cursor rules exported:`));
          for (const p of paths) {
            console.log(chalk.dim(`  ${p}`));
          }
          console.log(chalk.dim("  Cursor will follow these rules when working on your project\n"));
          break;
        }

        case "claude-hooks": {
          const path = await exportClaudeCodeHooks(pipeline, options.output ?? ".claude/settings.json");
          console.log(chalk.green(`✓ Claude Code hooks exported to: ${path}`));
          console.log(chalk.dim("  Pipeline stages will run as hooks during Claude Code sessions\n"));
          break;
        }

        default:
          console.log(chalk.red(`Unknown target: ${t}`));
          console.log(chalk.dim("Valid targets: claude-md, cursor-rules, claude-hooks, all"));
      }
    }

    console.log(chalk.bold.green("Done!"));
  } catch (error) {
    console.error(chalk.red(`Export failed: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}
