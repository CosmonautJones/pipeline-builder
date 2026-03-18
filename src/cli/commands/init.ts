import chalk from "chalk";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

interface InitOptions {
  dir: string;
}

export async function initCommand(options: InitOptions): Promise<void> {
  console.log(chalk.bold.cyan("\n🚀 Pipeline Builder — Init\n"));

  const dir = options.dir;

  if (existsSync(dir)) {
    console.log(chalk.yellow(`Directory ${dir} already exists`));
  } else {
    await mkdir(dir, { recursive: true });
    console.log(chalk.green(`Created: ${dir}/`));
  }

  // Create a minimal .env.example
  const envExample = `# Pipeline Builder Configuration
# ANTHROPIC_API_KEY=sk-ant-...
# LOG_LEVEL=info
`;

  const envPath = join(dir, ".env.example");
  if (!existsSync(envPath)) {
    await writeFile(envPath, envExample);
    console.log(chalk.green(`Created: ${envPath}`));
  }

  // Create a sample pipeline
  const samplePipeline = `apiVersion: pipeline-builder/v1
metadata:
  name: My First Pipeline
  version: "1.0.0"
  description: A sample pipeline — edit or run pb plan to generate a new one

variables:
  - name: message
    type: string
    default: "Hello from Pipeline Builder!"

trigger:
  type: manual

nodes:
  - id: start
    name: Start
    type: trigger
    outputs:
      - name: started
        type: boolean

  - id: greet
    name: Greet
    type: action
    tool: shell:exec
    toolInput:
      command: "echo {{ message }}"
    dependsOn:
      - start

edges:
  - from: start
    to: greet
`;

  const samplePath = join(dir, "sample.pipeline.yaml");
  if (!existsSync(samplePath)) {
    await writeFile(samplePath, samplePipeline);
    console.log(chalk.green(`Created: ${samplePath}`));
  }

  console.log(chalk.bold.green("\n✅ Pipeline Builder initialized!"));
  console.log(chalk.dim(`
Next steps:
  pb plan "describe what you want to automate"   # AI designs a pipeline
  pb validate ${dir}/sample.pipeline.yaml         # Validate a pipeline
  pb run ${dir}/sample.pipeline.yaml              # Execute a pipeline
  pb list                                          # Browse templates
`));
}
