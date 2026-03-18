import { z } from "zod";
import { BaseAgent } from "../base-agent.js";
import type { AgentRole, AgentContext, AgentResult, TaskPlan } from "../../types/agent.js";

const PlannerOutputSchema = z.object({
  goal: z.string(),
  subTasks: z.array(z.object({
    index: z.number(),
    description: z.string(),
    requiredCapabilities: z.array(z.string()),
    estimatedComplexity: z.enum(["low", "medium", "high"]),
  })),
  dependencies: z.array(z.object({
    from: z.number(),
    to: z.number(),
  })),
  assumptions: z.array(z.string()),
  openQuestions: z.array(z.string()),
});

export class PlannerAgent extends BaseAgent {
  readonly role: AgentRole = "planner";
  readonly description = "Decomposes high-level goals into ordered sub-tasks with dependencies";

  protected readonly systemPrompt = `You are the Planner Agent in an agentic pipeline builder system.

Your job is to take a high-level goal and decompose it into concrete, ordered sub-tasks that can later be translated into pipeline nodes.

## Your responsibilities:
1. Break the goal into the smallest meaningful sub-tasks
2. Identify dependencies between sub-tasks (which must complete before which)
3. Identify required capabilities/tools for each sub-task
4. Estimate complexity of each sub-task
5. Document assumptions you're making
6. Flag any remaining open questions

## Sub-task decomposition guidelines:
- Each sub-task should map to roughly ONE pipeline node
- Sub-tasks should be concrete and actionable (not vague)
- Use descriptive names: "Build Docker image" not "Step 3"
- Think about data flow: what does each step produce that the next needs?
- Consider error handling: what happens if a step fails?
- Include validation/testing steps where appropriate
- Include human checkpoints for high-risk operations

## Dependency rules:
- Dependencies form a DAG (no circular dependencies)
- Identify opportunities for parallelism (independent sub-tasks)
- Use { from: X, to: Y } meaning "task X must complete before task Y"

Return your plan as JSON:
\`\`\`json
{
  "goal": "Restated goal for clarity",
  "subTasks": [...],
  "dependencies": [...],
  "assumptions": [...],
  "openQuestions": [...]
}
\`\`\``;

  protected readonly outputSchema = PlannerOutputSchema;

  protected buildUserPrompt(context: AgentContext): string {
    const intent = context.currentIntent;
    const tools = context.availableTools;

    return `Decompose this goal into pipeline sub-tasks:

## Goal:
${intent?.goal ?? context.userMessages[context.userMessages.length - 1]?.content ?? ""}

${intent ? `## Context:
- Source (Point A): ${intent.sourceDescription ?? "Not specified"}
- Target (Point B): ${intent.targetDescription ?? "Not specified"}
- Domain: ${intent.domain ?? "General"}
- Constraints: ${intent.constraints.join(", ") || "None"}
- Preferences: ${intent.preferences.join(", ") || "None"}` : ""}

## Available Tools (${tools.length}):
${tools.slice(0, 30).map(t => `- ${t.server}:${t.name} — ${t.description}`).join("\n") || "No tools discovered yet — plan based on common capabilities"}

## Conversation so far:
${context.messages.map(m => `[${m.from}→${m.to}] ${m.content}`).join("\n") || "No prior agent messages"}

Generate a task decomposition plan as JSON.`;
  }

  protected toAgentResult(parsed: unknown, context: AgentContext): AgentResult {
    const plan = parsed as TaskPlan;

    return {
      messages: [
        this.createMessage(
          "orchestrator",
          "response",
          `Decomposed goal into ${plan.subTasks.length} sub-tasks with ${plan.dependencies.length} dependencies`,
          context,
          { plan },
        ),
      ],
      updatedPlan: plan,
      needsIteration: plan.openQuestions.length > 0,
      routeTo: plan.openQuestions.length > 0 ? "clarifier" : "architect",
    };
  }
}
