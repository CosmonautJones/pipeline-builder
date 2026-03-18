import { z } from "zod";
import { BaseAgent } from "../base-agent.js";
import type { AgentRole, AgentContext, AgentResult, ClarificationQuestion } from "../../types/agent.js";

const ClarifierOutputSchema = z.object({
  questions: z.array(z.object({
    id: z.string(),
    question: z.string(),
    category: z.enum(["scope", "technology", "constraint", "preference", "data", "security"]),
    priority: z.enum(["required", "recommended", "optional"]),
    options: z.array(z.string()).optional(),
    defaultAnswer: z.string().optional(),
  })),
  hasEnoughContext: z.boolean(),
  summary: z.string(),
});

export class ClarifierAgent extends BaseAgent {
  readonly role: AgentRole = "clarifier";
  readonly description = "Analyzes user intent for ambiguities and generates targeted clarifying questions";

  protected readonly systemPrompt = `You are the Clarifier Agent in an agentic pipeline builder system.

Your job is to analyze the user's goal/intent and identify what information is missing or ambiguous before a pipeline can be designed.

## Your responsibilities:
1. Analyze the user's stated goal for completeness
2. Identify technical ambiguities (which tools, frameworks, platforms)
3. Identify scope ambiguities (what's included/excluded)
4. Identify constraint ambiguities (performance, security, compliance)
5. Generate targeted questions ordered by priority
6. Determine if there's enough context to proceed

## Question categories:
- scope: What is and isn't included in the pipeline
- technology: Which specific tools, languages, frameworks
- constraint: Performance, security, compliance, resource limits
- preference: Preferred approaches when multiple valid options exist
- data: Input/output data formats, sources, destinations
- security: Authentication, secrets management, access control

## Rules:
- Ask the MINIMUM questions needed — don't over-question
- If the intent is clear enough, set hasEnoughContext: true with zero questions
- Provide options for questions when possible (makes it easier to answer)
- Prioritize "required" questions that block pipeline design
- "recommended" questions improve quality but aren't blockers
- "optional" questions are nice-to-have refinements

Return your analysis as JSON:
\`\`\`json
{
  "questions": [...],
  "hasEnoughContext": boolean,
  "summary": "Brief summary of what you understood from the intent"
}
\`\`\``;

  protected readonly outputSchema = ClarifierOutputSchema;

  protected buildUserPrompt(context: AgentContext): string {
    const intent = context.currentIntent;
    const tools = context.availableTools;

    return `Analyze this user intent and determine what clarifying questions are needed:

## User's Goal:
${intent?.rawInput ?? context.userMessages[context.userMessages.length - 1]?.content ?? "No input provided"}

${intent ? `## Parsed Intent:
- Goal: ${intent.goal}
- Source (Point A): ${intent.sourceDescription ?? "Not specified"}
- Target (Point B): ${intent.targetDescription ?? "Not specified"}
- Domain: ${intent.domain ?? "Unknown"}
- Constraints: ${intent.constraints.length > 0 ? intent.constraints.join(", ") : "None specified"}
- Preferences: ${intent.preferences.length > 0 ? intent.preferences.join(", ") : "None specified"}
- Confidence: ${intent.confidence}` : ""}

## Available Tools (${tools.length}):
${tools.slice(0, 20).map(t => `- ${t.server}:${t.name} — ${t.description}`).join("\n") || "No tools discovered yet"}

## Previous conversation:
${context.userMessages.map(m => `${m.role}: ${m.content}`).join("\n") || "No prior messages"}

Generate clarifying questions as JSON.`;
  }

  protected toAgentResult(parsed: unknown, context: AgentContext): AgentResult {
    const output = parsed as z.infer<typeof ClarifierOutputSchema>;

    const questions: ClarificationQuestion[] = output.questions.map(q => ({
      id: q.id,
      question: q.question,
      category: q.category,
      priority: q.priority,
      options: q.options,
      defaultAnswer: q.defaultAnswer,
    }));

    return {
      messages: [
        this.createMessage("orchestrator", "response", output.summary, context, { questions }),
      ],
      questionsForUser: questions,
      needsIteration: !output.hasEnoughContext,
      routeTo: output.hasEnoughContext ? "planner" : undefined,
    };
  }
}
