import chalk from "chalk";
import ora from "ora";
import { input, select, confirm } from "@inquirer/prompts";
import { Orchestrator, AnthropicProvider } from "../../agents/index.js";
import { PipelineStore } from "../../persistence/index.js";
import { TemplateRegistry } from "../../templates/index.js";
import type { ClarificationQuestion } from "../../types/agent.js";
import type { PipelineDefinition } from "../../types/pipeline.js";
import YAML from "yaml";

interface PlanOptions {
  template?: string;
  output: string;
  interactive: boolean;
  dryRun?: boolean;
}

export async function planCommand(goal: string, options: PlanOptions): Promise<void> {
  console.log(chalk.bold.cyan("\n🔧 Pipeline Builder — Design Mode\n"));
  console.log(chalk.dim(`Goal: "${goal}"\n`));

  // If starting from template, load it
  if (options.template) {
    const registry = new TemplateRegistry();
    const template = registry.get(options.template);
    if (template) {
      console.log(chalk.yellow(`Starting from template: ${template.name}\n`));
    }
  }

  const spinner = ora();
  const llm = new AnthropicProvider();

  const orchestrator = new Orchestrator(llm, {}, {
    onPhaseChange: (phase) => {
      const phaseLabels: Record<string, string> = {
        clarifying: "🔍 Gathering requirements",
        planning: "📋 Decomposing into tasks",
        architecting: "🏗️  Designing pipeline topology",
        building: "⚙️  Generating pipeline definition",
        validating: "✅ Validating pipeline",
        reviewing: "👀 Ready for review",
        complete: "🎉 Complete",
      };
      spinner.text = phaseLabels[phase] ?? phase;
      if (phase !== "complete") spinner.start();
      else spinner.succeed("Pipeline design complete!");
    },

    onQuestionsForUser: async (questions: ClarificationQuestion[]) => {
      spinner.stop();

      if (!options.interactive) {
        console.log(chalk.yellow("Skipping questions (non-interactive mode)"));
        return "";
      }

      console.log(chalk.bold("\n📝 A few questions to refine the design:\n"));

      const answers: string[] = [];
      for (const q of questions) {
        const priority = q.priority === "required"
          ? chalk.red("*")
          : q.priority === "recommended"
          ? chalk.yellow("~")
          : chalk.dim("○");

        if (q.options && q.options.length > 0) {
          const answer = await select({
            message: `${priority} ${q.question}`,
            choices: [
              ...q.options.map(o => ({ name: o, value: o })),
              { name: "Other (type custom answer)", value: "__other__" },
            ],
          });

          if (answer === "__other__") {
            const custom = await input({ message: "Your answer:" });
            answers.push(`${q.question} → ${custom}`);
          } else {
            answers.push(`${q.question} → ${answer}`);
          }
        } else {
          const answer = await input({
            message: `${priority} ${q.question}`,
            default: q.defaultAnswer,
          });
          answers.push(`${q.question} → ${answer}`);
        }
      }

      spinner.start();
      return answers.join("\n");
    },

    onPipelineReady: async (pipeline: PipelineDefinition) => {
      spinner.stop();
      console.log(chalk.bold.green("\n✨ Pipeline generated:\n"));
      console.log(chalk.dim("---"));
      console.log(YAML.stringify(pipeline, { indent: 2 }));
      console.log(chalk.dim("---\n"));

      console.log(chalk.bold(`Nodes: ${pipeline.nodes.length}`));
      console.log(chalk.bold(`Edges: ${pipeline.edges.length}`));
      console.log(chalk.bold(`Variables: ${pipeline.variables.length}`));
      console.log();

      if (!options.interactive) return "approve";

      const decision = await select({
        message: "What would you like to do?",
        choices: [
          { name: "✅ Approve and save", value: "approve" },
          { name: "✏️  Request modifications", value: "modify" },
          { name: "❌ Reject and start over", value: "reject" },
        ],
      });

      if (decision === "modify") {
        const feedback = await input({ message: "What should be changed?" });
        // Feedback gets added to conversation context by the orchestrator
        console.log(chalk.yellow(`\nRevising based on feedback: "${feedback}"\n`));
        spinner.start();
      }

      return decision as "approve" | "modify" | "reject";
    },

    onLog: (message) => {
      // Only show logs in verbose mode
      if (process.env.LOG_LEVEL === "debug") {
        console.log(chalk.dim(`  ${message}`));
      }
    },
  });

  spinner.start("Analyzing goal...");

  try {
    const pipeline = await orchestrator.designPipeline(goal);

    if (pipeline) {
      const store = new PipelineStore("./.pipelines");
      const filepath = await store.save(pipeline);
      console.log(chalk.green(`\n✅ Pipeline saved to: ${filepath}`));
    } else {
      console.log(chalk.red("\n❌ Pipeline design was cancelled."));
    }
  } catch (error) {
    spinner.fail("Pipeline design failed");
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
