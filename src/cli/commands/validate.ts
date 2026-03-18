import chalk from "chalk";
import { PipelineStore } from "../../persistence/index.js";
import { buildDAGFromPipeline, validatePipelineDAG } from "../../dag/index.js";

interface ValidateOptions {
  strict?: boolean;
}

export async function validateCommand(pipelinePath: string, options: ValidateOptions): Promise<void> {
  console.log(chalk.bold.cyan("\n✓ Pipeline Builder — Validate\n"));

  const store = new PipelineStore(".");

  try {
    const pipeline = await store.load(pipelinePath);
    console.log(`Validating: ${chalk.bold(pipeline.metadata.name)} (v${pipeline.metadata.version})\n`);

    // Build DAG
    const dag = buildDAGFromPipeline(pipeline);

    // Structural validation
    const result = validatePipelineDAG(dag, pipeline);

    // DAG stats
    const groups = dag.getParallelGroups();
    console.log(chalk.dim("Pipeline structure:"));
    console.log(`  Nodes: ${dag.nodeCount}`);
    console.log(`  Edges: ${dag.edgeCount}`);
    console.log(`  Entry points: ${dag.getRoots().length}`);
    console.log(`  Exit points: ${dag.getLeaves().length}`);
    console.log(`  Parallel waves: ${groups.length}`);
    console.log();

    // Show parallel execution plan
    console.log(chalk.dim("Execution waves:"));
    groups.forEach((group, i) => {
      console.log(`  Wave ${i + 1}: ${group.join(", ")}`);
    });
    console.log();

    // Show issues
    if (result.errors.length > 0) {
      console.log(chalk.red.bold("Errors:"));
      for (const err of result.errors) {
        console.log(chalk.red(`  ✗ ${err}`));
      }
      console.log();
    }

    if (result.warnings.length > 0) {
      console.log(chalk.yellow.bold("Warnings:"));
      for (const warn of result.warnings) {
        console.log(chalk.yellow(`  ⚠ ${warn}`));
      }
      console.log();
    }

    // Final verdict
    const hasIssues = result.errors.length > 0 || (options.strict && result.warnings.length > 0);

    if (hasIssues) {
      console.log(chalk.red.bold("✗ Validation FAILED"));
      process.exit(1);
    } else {
      console.log(chalk.green.bold("✓ Validation PASSED"));
    }
  } catch (error) {
    console.error(chalk.red(`Validation error: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}
