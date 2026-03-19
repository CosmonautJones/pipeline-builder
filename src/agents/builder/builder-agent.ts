import { z } from "zod";
import { BaseAgent } from "../base-agent.js";
import { PipelineDefinitionSchema } from "../../schema/pipeline.js";
import type { AgentRole, AgentContext, AgentResult } from "../../types/agent.js";
import type { PipelineDefinition } from "../../types/pipeline.js";

export class BuilderAgent extends BaseAgent {
  readonly role: AgentRole = "builder";
  readonly description = "Generates concrete PipelineDefinition from a blueprint";

  protected readonly systemPrompt = `You are the Builder Agent in an agentic pipeline builder system.

Your job is to take a pipeline blueprint (abstract design) and generate a complete, valid PipelineDefinition that can be executed.

## Your responsibilities:
1. Convert each blueprint step into a fully specified PipelineNode
2. Wire up edges with proper port mappings and input mappings
3. Define pipeline variables and secrets
4. Specify MCP server requirements
5. Add retry policies for unreliable operations
6. Add timeout policies
7. Set appropriate error policies (fail, skip, fallback)

## Output format:
Generate a complete PipelineDefinition matching this schema:
- apiVersion: "pipeline-builder/v1"
- metadata: { name, version, description, tags }
- nodes: Array of fully specified nodes
- edges: Array of edges with port mappings
- variables: Array of pipeline-level variables
- secrets: Array of secret names needed
- mcpServers: Array of MCP servers the pipeline depends on
- trigger: How the pipeline starts

## Node specification rules:
- id: lowercase-kebab-case matching the blueprint
- tool: "server:tool_name" format for action nodes
- toolInput: Static parameters (use "{{ variable_name }}" for dynamic values)
- inputMappings: { "paramName": "nodes.prev_step.outputs.fieldName" }
- inputs/outputs: Define the I/O contract with types
- retry: Add for network calls, API calls, deployments
- timeoutMs: Add for long-running operations
- errorPolicy: "fail" by default, "skip" for optional steps, "fallback" for steps with alternatives

## Rules:
- Every action node MUST have a tool specified
- Input mappings must reference existing node outputs
- Variables should have sensible defaults where possible
- Secrets should never have default values
- Use human-review nodes before destructive operations

Return the complete PipelineDefinition as JSON:
\`\`\`json
{ "apiVersion": "pipeline-builder/v1", ... }
\`\`\``;

  protected readonly outputSchema = PipelineDefinitionSchema;

  protected buildUserPrompt(context: AgentContext): string {
    const blueprint = context.currentBlueprint;
    const plan = context.currentPlan;

    return `Generate a complete PipelineDefinition from this blueprint:

## Blueprint:
${blueprint ? JSON.stringify(blueprint, null, 2) : "No blueprint — generate from plan"}

## Task Plan:
${plan ? JSON.stringify(plan, null, 2) : "No plan available"}

## Original Goal:
${context.currentIntent?.goal ?? "Not specified"}

## Available MCP Tools (USE THESE — they are real and connected):
${context.availableTools.slice(0, 40).map(t => `- ${t.server}:${t.name} — ${t.description}`).join("\n") || "No tools connected — use shell:exec as fallback for commands"}

IMPORTANT: Only reference tools from the list above. For any node that needs a tool not in this list,
use "shell:exec" with the appropriate command as a fallback. This ensures the pipeline is executable.

${context.feedbackHistory.length > 0 ? `## Feedback from previous iterations:
${context.feedbackHistory.map((f, i) => `${i + 1}. ${f}`).join("\n")}
Address ALL feedback points above.` : ""}

${context.currentPipeline ? `## Previous pipeline draft (to improve):
${JSON.stringify(context.currentPipeline, null, 2)}` : ""}

Generate the complete PipelineDefinition as JSON.`;
  }

  protected getMaxTokens(): number {
    return 8192; // Builder needs more tokens for full pipeline output
  }

  protected toAgentResult(parsed: unknown, context: AgentContext): AgentResult {
    const pipeline = parsed as PipelineDefinition;

    return {
      messages: [
        this.createMessage(
          "orchestrator",
          "response",
          `Generated pipeline "${pipeline.metadata.name}" with ${pipeline.nodes.length} nodes`,
          context,
          { pipeline },
        ),
      ],
      updatedPipeline: pipeline,
      needsIteration: false,
      routeTo: "validator",
    };
  }
}
