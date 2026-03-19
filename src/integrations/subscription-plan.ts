import type { PipelineDefinition } from "../types/pipeline.js";
import { TemplateRegistry } from "../templates/index.js";
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { PipelineDefinitionSchema } from "../schema/pipeline.js";

/**
 * Subscription-only plan mode.
 *
 * Instead of calling the Anthropic API directly, this generates instruction
 * files that teach Claude Code (CLAUDE.md) or Cursor (.cursor/rules) HOW
 * to design pipelines themselves — using the user's existing subscription.
 *
 * The flow:
 * 1. User runs: `pb plan "deploy my app" --subscription`
 * 2. We generate a CLAUDE.md with:
 *    - The pipeline schema reference
 *    - The design methodology (clarify → plan → architect → build → validate)
 *    - Relevant template examples
 *    - The user's specific goal
 *    - Instructions to write the YAML and validate with `pb validate`
 * 3. User opens Claude Code / Cursor and says "design the pipeline"
 * 4. The AI follows the instructions, writes the YAML, validates it
 *
 * No API key needed. The AI subscription does the work.
 */

const SCHEMA_REFERENCE = `
## Pipeline YAML Schema

\`\`\`yaml
apiVersion: pipeline-builder/v1   # Required, always this value

metadata:
  name: string                     # Pipeline name
  version: string                  # Semver (default: "1.0.0")
  description: string              # What this pipeline does
  tags: string[]                   # Categorization tags

# Variables the user provides at runtime
variables:
  - name: string                   # Variable name
    type: string | number | boolean | object | secret
    description: string            # What this variable is for
    default: any                   # Default value (omit for required)
    required: boolean              # Is this required? (default: true)

# Secret names (values provided at runtime, NEVER in the file)
secrets: string[]

# How the pipeline starts
trigger:
  type: manual | cron | webhook | event | file-watch
  config: {}                       # Type-specific config

# Pipeline nodes (vertices of the DAG)
nodes:
  - id: string                     # Unique, lowercase-kebab-case
    name: string                   # Human-readable name
    type: action | condition | transform | human-review | sub-pipeline | trigger | aggregator
    description: string

    # For action nodes — what tool to call
    tool: "server:tool_name"       # MCP tool identifier
    toolInput:                     # Parameters (use {{ var }} for templates)
      key: value

    # Dependencies
    dependsOn: [node_id, ...]      # Nodes that must complete first

    # Data flow
    inputMappings:                 # Where inputs come from
      param: "nodes.prev_step.outputs.field"
      param: "variables.var_name"

    inputs:                        # Input port declarations
      - name: string
        type: string | number | boolean | object | array | any
    outputs:                       # Output port declarations
      - name: string
        type: string | number | boolean | object | array | any

    # Conditional execution
    condition: "{{ var }} == 'value'"

    # Human review gate
    humanReview:
      prompt: string               # Question to ask the human
      approvalRequired: true

    # Policies
    retry:
      maxAttempts: number          # How many times to retry (default: 1)
      backoffMs: number            # Wait between retries (default: 1000)
      backoffMultiplier: number    # Exponential backoff (default: 2)
    errorPolicy: fail | skip       # fail = stop pipeline, skip = continue
    timeoutMs: number              # Max execution time for this node

# Explicit edges (alternative to dependsOn for port-level routing)
edges:
  - from: node_id
    to: node_id
    condition: string              # Optional guard expression

# MCP servers this pipeline needs
mcpServers:
  - name: string
    command: string                # e.g., "npx"
    args: string[]                 # e.g., ["-y", "@modelcontextprotocol/server-github"]
    env: { KEY: "value" }
    transport: stdio | streamable-http
\`\`\`
`;

const DESIGN_METHODOLOGY = `
## Pipeline Design Methodology

When the user asks you to design a pipeline, follow these steps IN ORDER:

### Step 1: Clarify (if needed)
Ask the user 2-3 targeted questions if the goal is ambiguous:
- What specific tools/platforms are involved?
- What triggers the pipeline?
- Are there approval gates needed?
- What happens on failure?

If the goal is clear, skip to Step 2.

### Step 2: Decompose
Break the goal into ordered sub-tasks:
1. List every step needed from start to finish
2. Identify which steps depend on which
3. Identify which steps can run in parallel
4. Note where human review is needed

### Step 3: Design the DAG
Map sub-tasks to pipeline nodes:
- Entry point → \`trigger\` node
- Tool calls → \`action\` nodes with \`tool: "shell:exec"\` and appropriate commands
- Approval gates → \`human-review\` nodes
- Branching logic → \`condition\` nodes
- Joining parallel branches → \`aggregator\` nodes
- Data transformation → \`transform\` nodes

### Step 4: Generate the YAML
Write the complete pipeline YAML following the schema above.
Save it to \`.pipelines/<name>.pipeline.yaml\`.

### Step 5: Validate
Run: \`pb validate .pipelines/<name>.pipeline.yaml\`
Fix any errors reported.

### Step 6: Present to User
Show the pipeline structure, explain the execution order, and ask for approval.
`;

const NODE_TYPE_GUIDE = `
## Node Type Decision Guide

| When you need to...                  | Use type        |
|--------------------------------------|-----------------|
| Start the pipeline                   | \`trigger\`     |
| Run a command or call a tool         | \`action\`      |
| Branch based on a condition          | \`condition\`   |
| Transform data between steps         | \`transform\`   |
| Pause for human approval             | \`human-review\`|
| Run another pipeline                 | \`sub-pipeline\`|
| Join parallel branches               | \`aggregator\`  |

### Common action patterns:
- Shell command: \`tool: "shell:exec"\`, \`toolInput: { command: "npm test" }\`
- Git operation: \`tool: "git:checkout"\`, \`toolInput: { branch: "{{ branch }}" }\`
- API call: \`tool: "fetch:get"\`, \`toolInput: { url: "{{ api_url }}" }\`
- File operation: \`tool: "filesystem:write"\`, \`toolInput: { path: "..." }\`

### When to use human-review:
- Before deploying to production
- Before deleting data
- Before sending external notifications
- Before any irreversible action
`;

export interface SubscriptionPlanOptions {
  goal: string;
  templateHint?: string;
  outputDir?: string;
  target?: "claude-code" | "cursor" | "both";
}

/**
 * Generate instruction files that teach Claude Code / Cursor how to
 * design a pipeline for the user's goal.
 */
export async function generateSubscriptionPlan(
  options: SubscriptionPlanOptions,
): Promise<{ files: string[]; instructions: string }> {
  const files: string[] = [];
  const outputDir = options.outputDir ?? ".";
  const target = options.target ?? "both";

  // Load relevant template as an example
  const registry = new TemplateRegistry();
  let templateExample = "";
  if (options.templateHint) {
    try {
      const template = await registry.load(options.templateHint);
      templateExample = `
## Starting Template

Here's a relevant template to build from. Modify it to match the goal:

\`\`\`yaml
${YAML.stringify(template, { indent: 2 })}
\`\`\`
`;
    } catch {
      // Template not found, that's fine
    }
  }

  // Find closest template by keyword matching
  if (!templateExample) {
    const templates = registry.list();
    const goalLower = options.goal.toLowerCase();
    const match = templates.find(t =>
      t.tags.some(tag => goalLower.includes(tag)) ||
      goalLower.includes(t.id)
    );
    if (match) {
      try {
        const template = await registry.load(match.id);
        templateExample = `
## Closest Template (${match.name})

Here's the closest built-in template. Use it as inspiration:

\`\`\`yaml
${YAML.stringify(template, { indent: 2 })}
\`\`\`
`;
      } catch {
        // ignore
      }
    }
  }

  // Build the content
  const content = `# Pipeline Builder — Design Task

## Your Goal

Design and generate a pipeline YAML file for the following:

> **${options.goal}**

Save the generated pipeline to \`.pipelines/\` when complete.
After writing the YAML, validate it by running: \`pb validate .pipelines/<name>.pipeline.yaml\`

${DESIGN_METHODOLOGY}

${SCHEMA_REFERENCE}

${NODE_TYPE_GUIDE}

${templateExample}

## Validation Commands

After generating the pipeline YAML:

\`\`\`bash
# Validate structure
pb validate .pipelines/<name>.pipeline.yaml

# Dry-run execution (simulates without running tools)
pb run .pipelines/<name>.pipeline.yaml --dry-run

# Export to tool configs
pb export .pipelines/<name>.pipeline.yaml -t all
\`\`\`

## Important Rules

1. All node IDs must be lowercase-kebab-case
2. Every action node must have a \`tool\` field (use \`shell:exec\` as fallback)
3. Use \`{{ variable_name }}\` for dynamic values in toolInput
4. Place \`human-review\` nodes before destructive operations
5. Add \`retry\` policies to network-dependent steps
6. Never hardcode secrets — use the \`secrets\` array
7. Maximize parallelism — if steps are independent, don't chain them sequentially
`;

  // Generate CLAUDE.md
  if (target === "claude-code" || target === "both") {
    const claudePath = join(outputDir, "CLAUDE.md");
    await writeFile(claudePath, content, "utf-8");
    files.push(claudePath);
  }

  // Generate Cursor rules
  if (target === "cursor" || target === "both") {
    const rulesDir = join(outputDir, ".cursor", "rules");
    if (!existsSync(rulesDir)) {
      await mkdir(rulesDir, { recursive: true });
    }

    const cursorContent = `---
description: Pipeline design task — generate pipeline YAML for user's goal
alwaysApply: true
---

${content}`;

    const cursorPath = join(rulesDir, "pipeline-design-task.mdc");
    await writeFile(cursorPath, cursorContent, "utf-8");
    files.push(cursorPath);
  }

  // Ensure .pipelines directory exists
  const pipelinesDir = join(outputDir, ".pipelines");
  if (!existsSync(pipelinesDir)) {
    await mkdir(pipelinesDir, { recursive: true });
  }

  const instructions = target === "cursor"
    ? `Open Cursor and say: "Design the pipeline described in the rules"`
    : `Open Claude Code and say: "Design the pipeline described in CLAUDE.md"`;

  return { files, instructions };
}
