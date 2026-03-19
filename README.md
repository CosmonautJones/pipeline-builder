# Pipeline Builder

A universal agentic pipeline builder that uses AI to design, validate, and execute automated workflows. Describe what you want in natural language — an AI agent system decomposes your goal, asks clarifying questions, architects a DAG-based pipeline, generates an executable definition, validates it, and runs it.

Built as a harness for **Claude Code** and **Cursor** subscriptions. One command to go from idea to running pipeline.

```
pb plan "run tests, build docker image, deploy to kubernetes on push to main"
```

## How It Works

```
You: "I want to deploy my app to k8s when code is pushed to main"

  ┌─────────────┐     ┌──────────┐     ┌───────────┐
  │  Clarifier   │ ──► │ Planner  │ ──► │ Architect │
  │ "Which K8s?" │     │ 7 tasks  │     │ DAG design│
  └─────────────┘     └──────────┘     └───────────┘
                                             │
      ┌──────────────────────────────────────┘
      ▼
  ┌─────────────┐     ┌───────────┐     ┌──────────┐
  │   Builder   │ ──► │ Validator │ ──► │   You    │
  │  YAML gen   │     │ 92/100 ✓  │     │ approve? │
  └─────────────┘     └───────────┘     └──────────┘
                                             │
                                             ▼
                                      pipeline.yaml
                                      (executable)
```

The agent system runs an **Intent → Clarify → Plan → Architect → Build → Validate → Review** loop. Each phase is handled by a specialist agent, coordinated by an orchestrator. The result is a validated YAML pipeline definition you can run, export, or integrate into your tools.

## Quick Start

```bash
# Install
npm install

# Initialize in your project
npx tsx src/cli/index.ts init

# Design a pipeline from natural language
npx tsx src/cli/index.ts plan "run tests and lint on every push, deploy on merge to main"

# Validate a pipeline
npx tsx src/cli/index.ts validate .pipelines/my-pipeline.pipeline.yaml

# Execute a pipeline
npx tsx src/cli/index.ts run .pipelines/my-pipeline.pipeline.yaml --dry-run

# Export to Claude Code / Cursor
npx tsx src/cli/index.ts export .pipelines/my-pipeline.pipeline.yaml -t all
```

> **Note:** The `plan` command requires an `ANTHROPIC_API_KEY` environment variable. The other commands work offline.

## CLI Reference

### `pb plan <goal>`

Design a pipeline from a natural language goal. The AI agent system will:
1. Analyze your goal and ask clarifying questions
2. Decompose it into tasks
3. Design the pipeline topology (DAG)
4. Generate a YAML pipeline definition
5. Validate it
6. Present it for your approval

```bash
pb plan "automate our release process"
pb plan "ETL pipeline from S3 to postgres" --template data-processing
pb plan "review PRs with AI" --no-interactive
```

| Flag | Description |
|------|-------------|
| `-t, --template <id>` | Start from a template (ci-cd, data-processing, content-generation, code-review) |
| `-o, --output <path>` | Output file path (default: `./pipeline.yaml`) |
| `--no-interactive` | Skip clarifying questions |
| `--dry-run` | Generate without saving |

### `pb run <pipeline>`

Execute a pipeline definition. Runs nodes in DAG order with parallel execution, retry policies, and human-in-the-loop checkpoints.

```bash
pb run .pipelines/deploy.pipeline.yaml
pb run .pipelines/deploy.pipeline.yaml --var environment=production --var region=us-east-1
pb run .pipelines/deploy.pipeline.yaml --dry-run
```

| Flag | Description |
|------|-------------|
| `-v, --var <key=value>` | Pipeline variables (repeatable) |
| `--dry-run` | Simulate execution without running tools |
| `--concurrency <n>` | Max parallel steps (default: 5) |

### `pb validate <pipeline>`

Validate a pipeline definition for structural correctness.

```bash
pb validate .pipelines/deploy.pipeline.yaml
pb validate .pipelines/deploy.pipeline.yaml --strict
```

Checks:
- DAG validity (no cycles, all dependencies resolvable)
- Node references in edges exist
- Action nodes have tools specified
- Input mappings reference valid nodes
- Displays parallel execution plan (waves)

### `pb list`

Browse available templates and saved pipelines.

```bash
pb list                # Show everything
pb list --templates    # Just templates
pb list --saved        # Just saved pipelines
```

### `pb init`

Initialize pipeline builder in a project. Creates a `.pipelines/` directory with a sample pipeline.

```bash
pb init
pb init --dir ./workflows
```

### `pb export <pipeline>`

Export a pipeline as configuration for Claude Code or Cursor.

```bash
pb export pipeline.yaml -t all              # Export everything
pb export pipeline.yaml -t claude-md        # Generate CLAUDE.md
pb export pipeline.yaml -t cursor-rules     # Generate .cursor/rules/
pb export pipeline.yaml -t claude-hooks     # Generate .claude/settings.json
```

| Target | What it generates |
|--------|-------------------|
| `claude-md` | `CLAUDE.md` — Project instructions that Claude Code reads on startup |
| `cursor-rules` | `.cursor/rules/*.mdc` — Rule files that configure Cursor's agent behavior |
| `claude-hooks` | `.claude/settings.json` — Event hooks that trigger pipeline stages |
| `all` | All of the above |

### `pb serve`

Start pipeline-builder as an MCP server. Claude Code and Cursor can connect to it and use its tools directly.

```bash
pb serve
```

Exposes these MCP tools:
- `pipeline_plan` — Design a pipeline from a goal
- `pipeline_run` — Execute a pipeline
- `pipeline_validate` — Validate a pipeline
- `pipeline_list` — List templates and saved pipelines
- `pipeline_from_template` — Generate from a built-in template

## Integration with Claude Code

Three ways to integrate, from lightest to deepest:

### 1. CLAUDE.md (Project Instructions)

```bash
pb export pipeline.yaml -t claude-md
```

Generates a `CLAUDE.md` file that Claude Code reads on startup. It teaches Claude your workflow: execution order, parallel stages, review gates, variables, and secrets. Claude Code will follow the pipeline structure when working on your project.

### 2. Claude Code Hooks (Automated Enforcement)

```bash
pb export pipeline.yaml -t claude-hooks
```

Generates `.claude/settings.json` with hooks that map pipeline stages to Claude Code events:

| Pipeline Stage | Hook Type | Trigger |
|----------------|-----------|---------|
| Lint/validate nodes | `PreToolUse` | Before file writes |
| Test nodes | `PostToolUse` | After file writes |
| Build nodes | `Stop` | When Claude finishes a task |
| Deploy nodes | `PreToolUse` (guarded) | Only on git push |

### 3. MCP Server (Full Integration)

Add to your Claude Code settings:

```json
{
  "mcpServers": {
    "pipeline-builder": {
      "command": "npx",
      "args": ["tsx", "src/integrations/mcp-server.ts"]
    }
  }
}
```

Now Claude Code can call pipeline-builder tools directly in conversation:
- "Design a pipeline for our deployment process" → calls `pipeline_plan`
- "Validate the CI pipeline" → calls `pipeline_validate`
- "Run the data processing pipeline" → calls `pipeline_run`

## Integration with Cursor

### 1. Cursor Rules

```bash
pb export pipeline.yaml -t cursor-rules
```

Generates `.cursor/rules/*.mdc` files with proper frontmatter. Cursor reads these to understand your workflow stages, review gates, and execution order. The master rule is set to `alwaysApply: true` so it's active in every session.

### 2. MCP Server

Cursor supports MCP servers the same way Claude Code does. Add the same MCP server config to Cursor's settings to get the same tool integration.

## Pipeline Schema

Pipelines are defined in YAML with this structure:

```yaml
apiVersion: pipeline-builder/v1

metadata:
  name: My Pipeline
  version: "1.0.0"
  description: What this pipeline does
  tags: [ci, deployment]

# Variables that can be provided at runtime
variables:
  - name: environment
    type: string
    default: staging
    required: true
  - name: concurrency
    type: number
    default: 4

# Secret names (values provided at runtime, never stored)
secrets:
  - DEPLOY_TOKEN
  - REGISTRY_PASSWORD

# How the pipeline starts
trigger:
  type: webhook  # manual | cron | webhook | event | file-watch
  config:
    event: push

# Pipeline nodes (the DAG vertices)
nodes:
  - id: checkout           # Unique ID (lowercase, hyphens/underscores)
    name: Checkout Code     # Human-readable name
    type: trigger           # Node type (see below)

  - id: run-tests
    name: Run Tests
    type: action
    tool: shell:exec        # MCP tool identifier (server:tool_name)
    toolInput:              # Parameters passed to the tool
      command: "npm test"
    dependsOn: [checkout]   # Nodes that must complete first
    retry:
      maxAttempts: 2
      backoffMs: 5000
      backoffMultiplier: 2
    errorPolicy: fail       # fail | skip | fallback

  - id: lint
    name: Run Linter
    type: action
    tool: shell:exec
    toolInput:
      command: "npm run lint"
    dependsOn: [checkout]
    errorPolicy: skip       # Non-blocking — continue on failure

  - id: build
    name: Build
    type: action
    tool: shell:exec
    toolInput:
      command: "npm run build"
    dependsOn: [run-tests, lint]  # Waits for both

  - id: approval
    name: Deploy Approval
    type: human-review
    humanReview:
      prompt: "Deploy to {{ environment }}?"
      approvalRequired: true
    dependsOn: [build]

  - id: deploy
    name: Deploy
    type: action
    tool: shell:exec
    toolInput:
      command: "kubectl apply -f k8s/ --namespace={{ environment }}"
    dependsOn: [approval]

# Explicit edges (optional — can also use dependsOn)
edges:
  - from: checkout
    to: run-tests
  - from: checkout
    to: lint
  - from: run-tests
    to: build
  - from: lint
    to: build
  - from: build
    to: approval
  - from: approval
    to: deploy

# MCP servers this pipeline needs
mcpServers:
  - name: github
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_TOKEN: ""
    transport: stdio
```

### Node Types

| Type | Purpose |
|------|---------|
| `trigger` | Pipeline entry point (webhook, cron, manual) |
| `action` | Executes a tool — the most common type |
| `condition` | If/else branching based on an expression |
| `transform` | Data transformation between steps |
| `human-review` | Pause for human approval before continuing |
| `sub-pipeline` | Invoke another pipeline definition |
| `aggregator` | Joins parallel branches back together |

### Input Mappings

Nodes can reference outputs from previous nodes:

```yaml
- id: deploy
  type: action
  tool: shell:exec
  inputMappings:
    image_tag: "nodes.build-image.outputs.tag"
    approval: "nodes.review.outputs.approved"
    env: "variables.environment"
  toolInput:
    command: "deploy {{ image_tag }} --env {{ env }}"
```

## Agent System

The pipeline builder uses 6 specialist AI agents coordinated by an orchestrator:

| Agent | Role | Input | Output |
|-------|------|-------|--------|
| **Clarifier** | Identifies ambiguities in your goal and generates targeted questions | User intent | Clarification questions |
| **Planner** | Decomposes the goal into ordered sub-tasks with dependencies | Clarified intent | Task plan with dependency graph |
| **Architect** | Designs the pipeline DAG topology — nodes, edges, parallelism | Task plan | Pipeline blueprint |
| **Builder** | Generates a complete, valid PipelineDefinition YAML | Blueprint | Pipeline definition |
| **Validator** | Critiques the pipeline for correctness, security, and best practices | Pipeline definition | Validation report (0-100 score) |
| **Router** | Analyzes context and routes work to the right specialist | Current state | Routing decision |

### Orchestrator State Machine

```
clarifying → planning → architecting → building → validating → reviewing → complete
     ↑           ↑                          ↑          │
     └───────────┴──────────────────────────┴──────────┘
                    (reflection loops)
```

Each phase can iterate up to 3 times (configurable). If the validator finds issues, it sends the pipeline back to the builder with feedback. If the planner has open questions, it sends them back to the clarifier. The orchestrator caps total iterations at 15 to prevent infinite loops.

## Built-in Templates

| Template | ID | Description |
|----------|----|-------------|
| CI/CD Pipeline | `ci-cd` | Test → build → Docker → deploy with approval gates |
| Data Processing | `data-processing` | Extract → validate → transform → load (ETL) |
| Content Generation | `content-generation` | Research → outline → draft → review → publish |
| Code Review | `code-review` | Fetch PR → parallel checks (lint, types, tests, AI review) → human approval |

Use a template as a starting point:

```bash
pb plan "customize the CI/CD pipeline for our Go project" --template ci-cd
```

## Programmatic API

Use pipeline-builder as a TypeScript library:

```typescript
import {
  Orchestrator,
  AnthropicProvider,
  PipelineRuntime,
  PipelineStore,
  PipelineDefinitionSchema,
  buildDAGFromPipeline,
  validatePipelineDAG,
  exportClaudeMd,
  exportCursorRules,
  exportClaudeCodeHooks,
} from "@pipeline-builder/core";

// Design a pipeline with the agent system
const llm = new AnthropicProvider();
const orchestrator = new Orchestrator(llm, {
  maxIterationsPerPhase: 3,
  maxTotalIterations: 15,
}, {
  onPhaseChange: (phase) => console.log(`Phase: ${phase}`),
  onQuestionsForUser: async (questions) => {
    // Return answers as a string
    return "Use pytest, deploy to staging first";
  },
  onPipelineReady: async (pipeline) => {
    console.log(pipeline);
    return "approve"; // or "modify" or "reject"
  },
});

const pipeline = await orchestrator.designPipeline(
  "Build and deploy our Python app with tests"
);

// Validate a pipeline
const dag = buildDAGFromPipeline(pipeline);
const validation = validatePipelineDAG(dag, pipeline);
console.log(validation); // { valid: true, errors: [], warnings: [] }

// Execute a pipeline
const runtime = new PipelineRuntime();
runtime.onStep(async (nodeId, inputs) => {
  // Your tool execution logic here
  return { result: "done" };
});

const result = await runtime.execute(pipeline, {
  variables: { environment: "staging" },
  onHumanReview: async (nodeId, prompt) => {
    return true; // approve
  },
});

// Save / load pipelines
const store = new PipelineStore("./.pipelines");
await store.save(pipeline); // saves as YAML
const loaded = await store.load("my-pipeline");

// Export to tool configs
await exportClaudeMd(pipeline, "CLAUDE.md");
await exportCursorRules(pipeline, ".cursor/rules");
await exportClaudeCodeHooks(pipeline, ".claude/settings.json");
```

## Project Structure

```
src/
├── schema/          Zod schemas (source of truth for all types)
├── types/           TypeScript types (inferred from Zod)
├── dag/             DAG engine (graph, topological sort, parallel groups)
├── agents/          6 specialist agents + orchestrator
│   ├── clarifier/   Generates clarifying questions
│   ├── planner/     Decomposes goals into tasks
│   ├── architect/   Designs pipeline topology
│   ├── builder/     Generates pipeline YAML
│   ├── validator/   Critiques pipeline quality
│   └── router/      Routes work between agents
├── engine/          Execution runtime (scheduler, state, checkpoints)
├── mcp/             MCP client manager + server installer
├── conversation/    User interaction / session management
├── integrations/    Claude Code, Cursor, MCP Server connectors
├── templates/       Built-in pipeline template registry
├── persistence/     YAML/JSON pipeline storage
├── cli/             CLI commands (plan, run, validate, export, serve)
└── utils/           Logging, errors, IDs, event bus
```

## Development

```bash
npm install          # Install dependencies
npm test             # Run tests (44 tests)
npm run typecheck    # Type check
npm run build        # Compile TypeScript
```

## Requirements

- Node.js >= 20
- `ANTHROPIC_API_KEY` environment variable (for `pb plan` and `pb serve`)
