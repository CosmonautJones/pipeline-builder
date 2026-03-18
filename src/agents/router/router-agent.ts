import { z } from "zod";
import { BaseAgent } from "../base-agent.js";
import type { AgentRole, AgentContext, AgentResult } from "../../types/agent.js";

const RouterOutputSchema = z.object({
  routeTo: z.enum(["clarifier", "planner", "architect", "builder", "validator"]),
  reasoning: z.string(),
  contextSummary: z.string(),
});

export class RouterAgent extends BaseAgent {
  readonly role: AgentRole = "router";
  readonly description = "Analyzes current context and routes work to the most appropriate specialist agent";

  protected readonly systemPrompt = `You are the Router Agent in an agentic pipeline builder system.

Your job is to analyze the current state of the pipeline design process and decide which specialist agent should handle the next step.

## Available agents:
- clarifier: User intent is ambiguous or missing information
- planner: Goal is clear but hasn't been decomposed into tasks yet
- architect: Tasks are defined but need to be organized into a pipeline topology
- builder: Architecture is designed but needs to be turned into a concrete pipeline definition
- validator: Pipeline definition exists and needs to be reviewed

## Decision criteria:
1. If the user's intent is unclear or has unanswered questions → clarifier
2. If intent is clear but no task plan exists → planner
3. If a plan exists but no blueprint → architect
4. If a blueprint exists but no pipeline definition → builder
5. If a pipeline definition exists but hasn't been validated → validator
6. If validation failed → builder (to fix issues)
7. If the user provides new input/changes → appropriate agent based on scope of change

Return your routing decision as JSON:
\`\`\`json
{
  "routeTo": "agent_name",
  "reasoning": "Why this agent is the right next step",
  "contextSummary": "Brief summary of current state"
}
\`\`\``;

  protected readonly outputSchema = RouterOutputSchema;

  protected buildUserPrompt(context: AgentContext): string {
    return `Decide which agent should handle the next step:

## Current State:
- Phase: ${context.phase}
- Iteration: ${context.iteration}/${context.maxIterations}
- Has intent: ${!!context.currentIntent}
- Has plan: ${!!context.currentPlan}
- Has blueprint: ${!!context.currentBlueprint}
- Has pipeline: ${!!context.currentPipeline}
- Available tools: ${context.availableTools.length}

## Recent messages:
${context.messages.slice(-5).map(m => `[${m.from}→${m.to}] (${m.type}) ${m.content}`).join("\n") || "None"}

## User messages:
${context.userMessages.slice(-3).map(m => `${m.role}: ${m.content}`).join("\n") || "None"}

Which agent should go next?`;
  }

  protected toAgentResult(parsed: unknown, context: AgentContext): AgentResult {
    const routing = parsed as z.infer<typeof RouterOutputSchema>;

    return {
      messages: [
        this.createMessage(
          "orchestrator",
          "response",
          `Routing to ${routing.routeTo}: ${routing.reasoning}`,
          context,
        ),
      ],
      needsIteration: false,
      routeTo: routing.routeTo,
    };
  }
}
