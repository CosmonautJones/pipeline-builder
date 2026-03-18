import chalk from "chalk";
import { TemplateRegistry } from "../../templates/index.js";
import { PipelineStore } from "../../persistence/index.js";

interface ListOptions {
  templates?: boolean;
  saved?: boolean;
}

export async function listCommand(options: ListOptions): Promise<void> {
  const showAll = !options.templates && !options.saved;

  if (showAll || options.templates) {
    console.log(chalk.bold.cyan("\n📋 Available Templates:\n"));
    const registry = new TemplateRegistry();
    const templates = registry.list();

    for (const t of templates) {
      console.log(`  ${chalk.bold(t.id.padEnd(22))} ${t.description}`);
      console.log(`  ${" ".repeat(22)} ${chalk.dim(`Tags: ${t.tags.join(", ")}`)}`);
      console.log();
    }

    console.log(chalk.dim(`  Use: pb plan "your goal" --template <id>\n`));
  }

  if (showAll || options.saved) {
    console.log(chalk.bold.cyan("💾 Saved Pipelines:\n"));
    const store = new PipelineStore("./.pipelines");
    const saved = await store.list();

    if (saved.length === 0) {
      console.log(chalk.dim("  No saved pipelines. Run `pb plan` to create one.\n"));
    } else {
      for (const p of saved) {
        console.log(`  ${chalk.bold(p.name.padEnd(30))} ${chalk.dim(p.format)} ${chalk.dim(p.path)}`);
      }
      console.log();
    }
  }
}
