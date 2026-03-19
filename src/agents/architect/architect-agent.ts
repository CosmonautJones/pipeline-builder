import { z } from "zod";
import { BaseAgent } from "../base-agent.js";
import type { AgentRole, AgentContext, AgentResult, PipelineBlueprint } from "../../types/agent.js";

const ArchitectOutputSchema = z.object({
  steps: z.array(z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    type: z.enum(["action", "condition", "transform", "human-review", "sub-pipeline", "trigger", "aggregator"]),
    toolHint: z.string(),
    inputs: z.array(z.string()),
    outputs: z.array(z.string()),
  })),
  edges: z.array(z.object({
    from: z.string(),
    to: z.string(),
    condition: z.string().optional(),
  })),
  missingCapabilities: z.array(z.string()),
  notes: z.array(z.string()),
});

export class ArchitectAgent extends BaseAgent {
  readonly role: AgentRole = "architect";
  readonly description = "Designs pipeline DAG topology — nodes, edges, data flow, and parallelism";

  protected readonly systemPrompt = `You are the Architect Agent in an agentic pipeline builder system.

Your job is to take a task plan and design the pipeline topology — the DAG of nodes and edges.

## Your responsibilities:
1. Map each sub-task to a pipeline node with a concrete type
2. Design the edge connections (data flow + dependencies)
3. Identify opportunities for parallel execution
4. Place human-review checkpoints at high-risk points
5. Add condition nodes for branching logic
6. Add aggregator nodes to join parallel branches
7. Identify missing capabilities (tools that need to be found/installed)

## Node types:
- trigger: Entry point (webhook, cron, manual start)
- action: Executes a tool (the most common type)
- condition: If/else branching based on an expression
- transform: Data transformation between steps
- human-review: Pause for human approval
- sub-pipeline: Invoke another pipeline
- aggregator: Joins parallel branches back together

## Design principles:
- Node IDs should be lowercase-kebab-case (e.g., "run-tests", "build-image")
- Maximize parallelism where dependencies allow
- Place human-review nodes before irreversible operations (deploy, publish, delete)
- Each node should have clear inputs and outputs for data flow
- Use toolHint to suggest which MCP tool/server should handle the action
- Condition nodes should have exactly 2+ outgoing edges with conditions

## Data flow:
- Outputs of one node feed into inputs of the next via edges
- Use descriptive port names (e.g., "test-results", "image-tag", "approval-status")

Return the blueprint as JSON:
\`\`\`json
{
  "steps": [...],
  "edges": [...],
  "missingCapabilities": [...],
  "notes": [...]
}
\`\`\``;

  protected readonly outputSchema = ArchitectOutputSchema;

  protected buildUserPrompt(context: AgentContext): string {
    const plan = context.currentPlan;
    const tools = context.availableTools;

    const connections = context.requiredConnections;

    return `Design a pipeline topology from this task plan:

## Task Plan:
${plan ? JSON.stringify(plan, null, 2) : "No plan available — design from intent"}

## Original Goal:
${context.currentIntent?.goal ?? "Not specified"}

## Required Connections (from intent analysis):
${connections.length > 0
  ? connections.map(c => `- ${c.system} (${c.connectionType}): ${c.purpose}`).join("\n")
  : "None identified — infer from the goal"}

## Available MCP Tools (${tools.length}):
${tools.slice(0, 40).map(t => `- ${t.server}:${t.name} — ${t.description}`).join("\n") || "No tools available — use generic tool hints"}

IMPORTANT: When specifying tool hints, prefer tools from the Available MCP Tools list above.
If a required capability has no matching tool, add it to missingCapabilities so the discovery agent can find it.

## Conversation context:
${context.messages.slice(-10).map(m => `[${m.from}→${m.to}] ${m.content}`).join("\n") || "No prior context"}

Design the pipeline blueprint as JSON.`;
  }

  protected toAgentResult(parsed: unknown, context: AgentContext): AgentResult {
    const blueprint = parsed as PipelineBlueprint;

    return {
      messages: [
        this.createMessage(
          "orchestrator",
          "response",
          `Designed pipeline with ${blueprint.steps.length} nodes and ${blueprint.edges.length} edges. ${blueprint.missingCapabilities.length} missing capabilities identified.`,
          context,
          { blueprint },
        ),
      ],
      updatedBlueprint: blueprint,
      needsIteration: false,
      routeTo: "builder",
    };
  }
}
