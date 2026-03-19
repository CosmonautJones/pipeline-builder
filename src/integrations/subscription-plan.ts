import { TemplateRegistry } from "../templates/index.js";
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";

/**
 * Subscription-only plan mode — multi-file architecture.
 *
 * Instead of one massive CLAUDE.md, generates:
 *   CLAUDE.md                              (~40 lines — goal + TOC + commands)
 *   .pipeline-builder/docs/schema.md       (YAML schema reference)
 *   .pipeline-builder/docs/methodology.md  (design methodology)
 *   .pipeline-builder/docs/node-types.md   (node type guide)
 *   .pipeline-builder/docs/template.md     (matched template example)
 *   .pipeline-builder/docs/rules.md        (validation rules)
 *
 * For Cursor, generates multiple focused .mdc rule files.
 *
 * The AI reads the slim entry point and pulls in reference docs as needed.
 */

export interface SubscriptionPlanOptions {
  goal: string;
  templateHint?: string;
  outputDir?: string;
  target?: "claude-code" | "cursor" | "both";
}

// ── Document chunks ─────────────────────────────────────────────────

const METHODOLOGY = `# Pipeline Design Methodology

Follow these steps IN ORDER when designing a pipeline:

## Step 1: Clarify (if needed)
Ask 2-3 targeted questions if the goal is ambiguous:
- What tools/platforms are involved?
- What triggers the pipeline?
- Are there approval gates needed?

Skip this if the goal is already clear.

## Step 2: Decompose
Break the goal into ordered sub-tasks:
1. List every step from start to finish
2. Identify dependencies (which steps need which)
3. Identify parallelism (independent steps)
4. Note where human review is needed

## Step 3: Design the DAG
Map sub-tasks to pipeline nodes:
- Entry point → \`trigger\` node
- Tool calls → \`action\` nodes
- Approval gates → \`human-review\` nodes
- Branching → \`condition\` nodes
- Joining branches → \`aggregator\` nodes

## Step 4: Write the YAML
Generate the pipeline YAML in \`.pipelines/<name>.pipeline.yaml\`.
Follow the schema in \`.pipeline-builder/docs/schema.md\`.

## Step 5: Validate
\`\`\`bash
pb validate .pipelines/<name>.pipeline.yaml
\`\`\`
Fix any errors, then present the pipeline to the user.
`;

const SCHEMA = `# Pipeline YAML Schema Reference

\`\`\`yaml
apiVersion: pipeline-builder/v1

metadata:
  name: string                     # Pipeline name
  version: "1.0.0"                 # Semver
  description: string              # What this pipeline does
  tags: [string]                   # Categorization

variables:                         # User-provided at runtime
  - name: string
    type: string | number | boolean | object | secret
    description: string
    default: any                   # Omit for required vars
    required: boolean

secrets: [string]                  # Secret names (NEVER store values)

trigger:
  type: manual | cron | webhook | event | file-watch
  config: {}

nodes:                             # DAG vertices
  - id: lowercase-kebab-case       # Unique node ID
    name: string                   # Human-readable
    type: action | condition | transform | human-review | sub-pipeline | trigger | aggregator
    tool: "server:tool_name"       # For action nodes
    toolInput:                     # Use {{ var }} for templates
      command: "npm test"
    dependsOn: [node_id]           # Must complete first
    inputMappings:                 # Data flow from other nodes
      param: "nodes.prev.outputs.field"
      param: "variables.var_name"
    condition: "{{ var }} == 'value'"  # For condition nodes
    humanReview:                   # For human-review nodes
      prompt: "Approve?"
      approvalRequired: true
    retry:                         # Retry policy
      maxAttempts: 3
      backoffMs: 1000
      backoffMultiplier: 2
    errorPolicy: fail | skip       # fail = stop, skip = continue
    timeoutMs: 30000

edges:                             # Explicit connections (alt to dependsOn)
  - from: node_id
    to: node_id
    condition: string              # Optional guard

mcpServers:                        # Required MCP servers
  - name: string
    command: "npx"
    args: ["-y", "package-name"]
    transport: stdio
\`\`\`
`;

const NODE_TYPES = `# Node Type Guide

| Need to...                       | Use type        | Example                          |
|----------------------------------|-----------------|----------------------------------|
| Start the pipeline               | \`trigger\`     | Webhook, cron, manual start      |
| Run a command or tool            | \`action\`      | \`npm test\`, API call, deploy   |
| Branch on a condition            | \`condition\`   | if env == "production"           |
| Transform data between steps     | \`transform\`   | Format output for next step      |
| Pause for human approval         | \`human-review\`| Before deploy, before delete     |
| Run another pipeline             | \`sub-pipeline\`| Reusable sub-workflows           |
| Join parallel branches           | \`aggregator\`  | Collect results from parallel    |

## Common action patterns

\`\`\`yaml
# Shell command
- id: run-tests
  type: action
  tool: "shell:exec"
  toolInput: { command: "npm test" }

# With retry for flaky operations
- id: deploy
  type: action
  tool: "shell:exec"
  toolInput: { command: "kubectl apply -f k8s/" }
  retry: { maxAttempts: 3, backoffMs: 2000 }

# Human gate before destructive ops
- id: approve-deploy
  type: human-review
  humanReview:
    prompt: "Deploy to {{ environment }}?"
    approvalRequired: true

# Parallel steps (same dependsOn)
- id: lint
  type: action
  tool: "shell:exec"
  toolInput: { command: "npm run lint" }
  dependsOn: [checkout]
  errorPolicy: skip              # Non-blocking

- id: test
  type: action
  tool: "shell:exec"
  toolInput: { command: "npm test" }
  dependsOn: [checkout]          # Same dep = parallel with lint
\`\`\`
`;

const RULES = `# Pipeline Rules

1. Node IDs must be \`lowercase-kebab-case\`
2. Every \`action\` node must have a \`tool\` field (use \`shell:exec\` as fallback)
3. Use \`{{ variable_name }}\` for dynamic values in toolInput
4. Place \`human-review\` nodes before destructive operations (deploy, delete, publish)
5. Add \`retry\` policies to network-dependent steps
6. Never hardcode secrets — use the \`secrets\` array
7. Maximize parallelism — if steps are independent, don't chain them
8. Run \`pb validate\` after generating to catch structural errors

## Validation commands

\`\`\`bash
pb validate .pipelines/<name>.pipeline.yaml          # Check structure
pb run .pipelines/<name>.pipeline.yaml --dry-run     # Simulate execution
pb export .pipelines/<name>.pipeline.yaml -t all     # Export to tool configs
\`\`\`
`;

// ── Generator ───────────────────────────────────────────────────────

export async function generateSubscriptionPlan(
  options: SubscriptionPlanOptions,
): Promise<{ files: string[]; instructions: string }> {
  const files: string[] = [];
  const outputDir = options.outputDir ?? ".";
  const target = options.target ?? "both";
  const docsDir = join(outputDir, ".pipeline-builder", "docs");

  // Ensure directories exist
  if (!existsSync(docsDir)) await mkdir(docsDir, { recursive: true });
  const pipelinesDir = join(outputDir, ".pipelines");
  if (!existsSync(pipelinesDir)) await mkdir(pipelinesDir, { recursive: true });

  // Load relevant template
  const registry = new TemplateRegistry();
  let templateContent = "";
  let templateName = "";

  if (options.templateHint) {
    try {
      const t = await registry.load(options.templateHint);
      templateContent = YAML.stringify(t, { indent: 2 });
      templateName = options.templateHint;
    } catch { /* not found */ }
  }

  if (!templateContent) {
    const templates = registry.list();
    const goalLower = options.goal.toLowerCase();
    const match = templates.find(t =>
      t.tags.some(tag => goalLower.includes(tag)) || goalLower.includes(t.id)
    );
    if (match) {
      try {
        const t = await registry.load(match.id);
        templateContent = YAML.stringify(t, { indent: 2 });
        templateName = match.name;
      } catch { /* ignore */ }
    }
  }

  // ── Write reference docs ────────────────────────────────────────

  await writeFile(join(docsDir, "methodology.md"), METHODOLOGY, "utf-8");
  await writeFile(join(docsDir, "schema.md"), SCHEMA, "utf-8");
  await writeFile(join(docsDir, "node-types.md"), NODE_TYPES, "utf-8");
  await writeFile(join(docsDir, "rules.md"), RULES, "utf-8");
  files.push(
    join(docsDir, "methodology.md"),
    join(docsDir, "schema.md"),
    join(docsDir, "node-types.md"),
    join(docsDir, "rules.md"),
  );

  if (templateContent) {
    const templateDoc = `# Template: ${templateName}\n\nUse as a starting point. Modify to match the goal.\n\n\`\`\`yaml\n${templateContent}\`\`\`\n`;
    await writeFile(join(docsDir, "template.md"), templateDoc, "utf-8");
    files.push(join(docsDir, "template.md"));
  }

  // ── Generate CLAUDE.md (slim entry point) ───────────────────────

  if (target === "claude-code" || target === "both") {
    const claudeMd = `# Pipeline Builder — Design Task

## Goal

> **${options.goal}**

## What to do

Design a pipeline YAML and save it to \`.pipelines/<name>.pipeline.yaml\`.

## Reference docs

Read these as needed (in \`.pipeline-builder/docs/\`):

| Doc | When to read |
|-----|-------------|
| [methodology.md](.pipeline-builder/docs/methodology.md) | Start here — the 5-step design process |
| [schema.md](.pipeline-builder/docs/schema.md) | When writing the YAML — field reference |
| [node-types.md](.pipeline-builder/docs/node-types.md) | When choosing node types — examples |
| [rules.md](.pipeline-builder/docs/rules.md) | Before finalizing — validation checklist |
${templateContent ? `| [template.md](.pipeline-builder/docs/template.md) | Closest built-in template to start from |` : ""}

## Quick start

1. Read \`.pipeline-builder/docs/methodology.md\`
2. Follow the 5 steps (clarify → decompose → design → write → validate)
3. Save to \`.pipelines/\`
4. Run: \`pb validate .pipelines/<name>.pipeline.yaml\`
`;

    const claudePath = join(outputDir, "CLAUDE.md");
    await writeFile(claudePath, claudeMd, "utf-8");
    files.push(claudePath);
  }

  // ── Generate Cursor rules (multiple focused files) ──────────────

  if (target === "cursor" || target === "both") {
    const rulesDir = join(outputDir, ".cursor", "rules");
    if (!existsSync(rulesDir)) await mkdir(rulesDir, { recursive: true });

    // Rule 1: Task (always active, slim)
    const taskRule = `---
description: "Pipeline design task — the current goal"
alwaysApply: true
---

# Pipeline Design Task

**Goal:** ${options.goal}

Save the pipeline to \`.pipelines/<name>.pipeline.yaml\`.
Follow the methodology in \`.pipeline-builder/docs/methodology.md\`.
Validate with: \`pb validate .pipelines/<name>.pipeline.yaml\`
`;
    await writeFile(join(rulesDir, "pb-task.mdc"), taskRule, "utf-8");

    // Rule 2: Schema (activates when editing pipeline YAML)
    const schemaRule = `---
description: "Pipeline YAML schema reference"
globs: "**/*.pipeline.yaml,**/*.pipeline.json"
---

${SCHEMA}
`;
    await writeFile(join(rulesDir, "pb-schema.mdc"), schemaRule, "utf-8");

    // Rule 3: Node types (activates when editing pipeline YAML)
    const nodeRule = `---
description: "Pipeline node type reference and examples"
globs: "**/*.pipeline.yaml"
---

${NODE_TYPES}
`;
    await writeFile(join(rulesDir, "pb-nodes.mdc"), nodeRule, "utf-8");

    // Rule 4: Rules (activates when editing pipeline YAML)
    const rulesRule = `---
description: "Pipeline validation rules"
globs: "**/*.pipeline.yaml"
---

${RULES}
`;
    await writeFile(join(rulesDir, "pb-rules.mdc"), rulesRule, "utf-8");

    files.push(
      join(rulesDir, "pb-task.mdc"),
      join(rulesDir, "pb-schema.mdc"),
      join(rulesDir, "pb-nodes.mdc"),
      join(rulesDir, "pb-rules.mdc"),
    );
  }

  const instructions = target === "cursor"
    ? `Open Cursor and say: "Design the pipeline described in the rules"`
    : `Open Claude Code and say: "Design the pipeline"`;

  return { files, instructions };
}
