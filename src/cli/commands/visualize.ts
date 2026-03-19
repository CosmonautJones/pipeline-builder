import chalk from "chalk";
import { PipelineStore } from "../../persistence/index.js";
import { buildDAGFromPipeline, visualizeDAG, visualizeFlow } from "../../dag/index.js";

interface VisualizeOptions {
  compact?: boolean;
}

export async function visualizeCommand(pipelinePath: string, options: VisualizeOptions): Promise<void> {
  const store = new PipelineStore(".");

  try {
    const pipeline = await store.load(pipelinePath);
    const dag = buildDAGFromPipeline(pipeline);

    console.log(chalk.bold.cyan(`\n${pipeline.metadata.name}`) + chalk.dim(` v${pipeline.metadata.version}`));
    if (pipeline.metadata.description) {
      console.log(chalk.dim(pipeline.metadata.description));
    }
    console.log();

    if (options.compact) {
      console.log("  " + visualizeFlow(dag));
    } else {
      console.log(visualizeDAG(dag));
    }
    console.log();
  } catch (error) {
    console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}
