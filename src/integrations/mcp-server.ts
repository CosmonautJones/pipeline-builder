import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { PipelineStore } from "../persistence/index.js";
import { PipelineRuntime } from "../engine/runtime.js";
import { buildDAGFromPipeline, validatePipelineDAG } from "../dag/index.js";
import { Orchestrator, AnthropicProvider } from "../agents/index.js";
import { TemplateRegistry } from "../templates/index.js";
import YAML from "yaml";

/**
 * Exposes pipeline-builder as an MCP server.
 *
 * Claude Code (or Cursor) can connect to this server and use its tools:
 *   - pipeline_plan: Design a pipeline from a goal
 *   - pipeline_run: Execute a saved pipeline
 *   - pipeline_validate: Validate a pipeline definition
 *   - pipeline_list: List templates and saved pipelines
 *   - pipeline_from_template: Generate a pipeline from a template
 *
 * Usage:
 *   Add to Claude Code settings.json:
 *   {
 *     "mcpServers": {
 *       "pipeline-builder": {
 *         "command": "npx",
 *         "args": ["tsx", "path/to/pipeline-builder/src/integrations/mcp-server.ts"]
 *       }
 *     }
 *   }
 */

const store = new PipelineStore("./.pipelines");
const templateRegistry = new TemplateRegistry();

const server = new Server(
  { name: "pipeline-builder", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

// ── Tool Definitions ────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "pipeline_plan",
      description:
        "Design an automated pipeline/workflow from a natural language goal. " +
        "An AI agent will analyze the goal, ask clarifying questions internally, " +
        "decompose it into tasks, design a DAG topology, and generate a YAML pipeline definition.",
      inputSchema: {
        type: "object" as const,
        properties: {
          goal: {
            type: "string",
            description: "Natural language description of what the pipeline should accomplish (point A → point B)",
          },
          template: {
            type: "string",
            description: "Optional template ID to start from (ci-cd, data-processing, content-generation, code-review)",
          },
          save: {
            type: "boolean",
            description: "Whether to save the generated pipeline to disk (default: true)",
          },
        },
        required: ["goal"],
      },
    },
    {
      name: "pipeline_validate",
      description:
        "Validate a pipeline definition for structural correctness. " +
        "Checks DAG validity (no cycles), node references, tool availability, and best practices.",
      inputSchema: {
        type: "object" as const,
        properties: {
          pipeline_path: {
            type: "string",
            description: "Path to a pipeline YAML/JSON file",
          },
          pipeline_yaml: {
            type: "string",
            description: "Inline pipeline definition as YAML (alternative to pipeline_path)",
          },
          strict: {
            type: "boolean",
            description: "Treat warnings as errors (default: false)",
          },
        },
      },
    },
    {
      name: "pipeline_run",
      description:
        "Execute a pipeline definition. Runs nodes in DAG order with parallel execution, " +
        "retry policies, and state tracking.",
      inputSchema: {
        type: "object" as const,
        properties: {
          pipeline_path: {
            type: "string",
            description: "Path to pipeline YAML/JSON file",
          },
          variables: {
            type: "object",
            description: "Pipeline variables as key-value pairs",
          },
          dry_run: {
            type: "boolean",
            description: "Simulate execution without running tools (default: false)",
          },
        },
        required: ["pipeline_path"],
      },
    },
    {
      name: "pipeline_list",
      description: "List available pipeline templates and saved pipelines.",
      inputSchema: {
        type: "object" as const,
        properties: {
          type: {
            type: "string",
            enum: ["templates", "saved", "all"],
            description: "What to list (default: all)",
          },
        },
      },
    },
    {
      name: "pipeline_from_template",
      description:
        "Generate a pipeline from a built-in template. " +
        "Templates available: ci-cd, data-processing, content-generation, code-review.",
      inputSchema: {
        type: "object" as const,
        properties: {
          template_id: {
            type: "string",
            description: "Template ID",
            enum: ["ci-cd", "data-processing", "content-generation", "code-review"],
          },
          variables: {
            type: "object",
            description: "Template variables to fill in",
          },
          save: {
            type: "boolean",
            description: "Save the generated pipeline (default: true)",
          },
        },
        required: ["template_id"],
      },
    },
  ],
}));

// ── Tool Handlers ───────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "pipeline_plan": {
        const goal = args?.goal as string;
        const save = (args?.save as boolean) ?? true;

        const llm = new AnthropicProvider();
        const orchestrator = new Orchestrator(llm);
        const pipeline = await orchestrator.designPipeline(goal);

        if (!pipeline) {
          return { content: [{ type: "text", text: "Pipeline design failed or was rejected." }], isError: true };
        }

        if (save) {
          const filepath = await store.save(pipeline);
          return {
            content: [
              { type: "text", text: `Pipeline designed and saved to: ${filepath}\n\n${YAML.stringify(pipeline, { indent: 2 })}` },
            ],
          };
        }

        return {
          content: [{ type: "text", text: YAML.stringify(pipeline, { indent: 2 }) }],
        };
      }

      case "pipeline_validate": {
        let pipeline;
        if (args?.pipeline_path) {
          pipeline = await store.load(args.pipeline_path as string);
        } else if (args?.pipeline_yaml) {
          const { PipelineDefinitionSchema } = await import("../schema/pipeline.js");
          pipeline = PipelineDefinitionSchema.parse(YAML.parse(args.pipeline_yaml as string));
        } else {
          return { content: [{ type: "text", text: "Provide pipeline_path or pipeline_yaml" }], isError: true };
        }

        const dag = buildDAGFromPipeline(pipeline);
        const result = validatePipelineDAG(dag, pipeline);
        const groups = dag.getParallelGroups();

        const report = [
          `Pipeline: ${pipeline.metadata.name} (v${pipeline.metadata.version})`,
          `Nodes: ${dag.nodeCount} | Edges: ${dag.edgeCount} | Parallel waves: ${groups.length}`,
          "",
          `Execution plan:`,
          ...groups.map((g, i) => `  Wave ${i + 1}: ${g.join(", ")}`),
          "",
          result.valid ? "VALID" : "INVALID",
          ...result.errors.map(e => `ERROR: ${e}`),
          ...result.warnings.map(w => `WARNING: ${w}`),
        ].join("\n");

        return { content: [{ type: "text", text: report }], isError: !result.valid };
      }

      case "pipeline_run": {
        const pipelinePath = args?.pipeline_path as string;
        const variables = (args?.variables as Record<string, unknown>) ?? {};
        const dryRun = (args?.dry_run as boolean) ?? false;

        const pipeline = await store.load(pipelinePath);
        const runtime = new PipelineRuntime();
        const logs: string[] = [];

        const result = await runtime.execute(pipeline, {
          dryRun,
          variables,
          onStepStart: (id) => logs.push(`[START] ${id}`),
          onStepComplete: (id) => logs.push(`[DONE]  ${id}`),
          onStepFailed: (id, err) => logs.push(`[FAIL]  ${id}: ${err}`),
        });

        const summary = [
          `Pipeline: ${pipeline.metadata.name}`,
          `Status: ${result.status}`,
          `Duration: ${(result.completedAt ?? Date.now()) - result.startedAt}ms`,
          "",
          "Execution log:",
          ...logs,
        ].join("\n");

        return { content: [{ type: "text", text: summary }], isError: result.status === "failed" };
      }

      case "pipeline_list": {
        const type = (args?.type as string) ?? "all";
        const sections: string[] = [];

        if (type === "all" || type === "templates") {
          const templates = templateRegistry.list();
          sections.push("Templates:");
          sections.push(...templates.map(t => `  ${t.id.padEnd(22)} ${t.description}`));
          sections.push("");
        }

        if (type === "all" || type === "saved") {
          const saved = await store.list();
          sections.push("Saved pipelines:");
          if (saved.length === 0) {
            sections.push("  (none)");
          } else {
            sections.push(...saved.map(s => `  ${s.name.padEnd(30)} ${s.format} ${s.path}`));
          }
        }

        return { content: [{ type: "text", text: sections.join("\n") }] };
      }

      case "pipeline_from_template": {
        const templateId = args?.template_id as string;
        const save = (args?.save as boolean) ?? true;

        const pipeline = await templateRegistry.load(templateId);

        if (save) {
          const filepath = await store.save(pipeline);
          return {
            content: [{ type: "text", text: `Template loaded and saved to: ${filepath}\n\n${YAML.stringify(pipeline, { indent: 2 })}` }],
          };
        }

        return { content: [{ type: "text", text: YAML.stringify(pipeline, { indent: 2 }) }] };
      }

      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true,
    };
  }
});

// ── Start Server ────────────────────────────────────────────────────

export async function startMCPServer(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Run directly if executed as a script
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  startMCPServer().catch(console.error);
}
