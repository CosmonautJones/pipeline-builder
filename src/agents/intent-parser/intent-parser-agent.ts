import { z } from "zod";
import { BaseAgent } from "../base-agent.js";
import type { AgentRole, AgentContext, AgentResult, ParsedIntent } from "../../types/agent.js";

const IntentOutputSchema = z.object({
  goal: z.string(),
  sourceDescription: z.string().optional(),
  targetDescription: z.string().optional(),
  domain: z.enum([
    "ci-cd", "data-processing", "content-generation", "code-review",
    "deployment", "monitoring", "testing", "security", "infrastructure",
    "communication", "integration", "automation", "other",
  ]).optional(),
  constraints: z.array(z.string()),
  preferences: z.array(z.string()),
  suggestedTools: z.array(z.string()),
  requiredConnections: z.array(z.object({
    system: z.string(),
    purpose: z.string(),
    connectionType: z.enum(["api", "database", "filesystem", "messaging", "shell", "mcp", "other"]),
  })),
  confidence: z.number().min(0).max(1),
  ambiguities: z.array(z.string()),
});

/**
 * LLM-based intent parser that extracts structured intent from natural language.
 * This replaces the stub `quickParseIntent()` in the orchestrator.
 *
 * It identifies:
 * - The core goal and domain
 * - Source state (point A) and target state (point B)
 * - Required system connections (APIs, databases, services)
 * - Technical constraints and preferences
 * - Ambiguities that need clarification
 * - Confidence level (high = skip clarification, low = ask more)
 */
export class IntentParserAgent extends BaseAgent {
  readonly role: AgentRole = "orchestrator"; // runs as part of orchestrator phase
  readonly description = "Extracts structured intent from natural language goals, identifying connections, domains, and ambiguities";

  protected readonly systemPrompt = `You are an Intent Parser for an agentic pipeline builder.

Your job is to take a user's natural language goal and extract structured information that pipeline design agents need.

## What to extract:

### Goal & Domain
- Restate the goal clearly and concisely
- Identify the domain (ci-cd, data-processing, deployment, etc.)
- Identify the source state (point A — where things start) and target state (point B — desired outcome)

### Required Connections
This is CRITICAL. Identify every external system, service, API, or tool the pipeline will need to connect to. For each:
- system: Name of the system (e.g., "GitHub", "PostgreSQL", "Kubernetes", "S3", "Slack")
- purpose: Why the pipeline needs it (e.g., "fetch code changes", "store processed data")
- connectionType: How to connect (api, database, filesystem, messaging, shell, mcp, other)

Think about the FULL chain:
- Where does data come from? (source systems)
- Where does data go? (target systems)
- What tools are needed in between? (processing, validation, notification)
- What needs to be notified? (messaging, monitoring)

### Constraints & Preferences
- Hard constraints (must use X, can't exceed Y, required compliance)
- Soft preferences (prefer X over Y, nice-to-have features)

### Suggested Tools
- Based on the domain and connections, suggest specific MCP servers or tools
- Use format: "server-name:tool-name" or just "server-name"

### Ambiguities
- What's unclear or could be interpreted multiple ways?
- What information would improve the pipeline design?

### Confidence (0-1)
- 0.9-1.0: Crystal clear, can proceed directly to planning
- 0.7-0.8: Pretty clear, maybe 1-2 minor questions
- 0.4-0.6: Significant ambiguity, needs clarification
- 0.0-0.3: Very vague, needs major clarification

Return your analysis as JSON:
\`\`\`json
{
  "goal": "...",
  "sourceDescription": "...",
  "targetDescription": "...",
  "domain": "...",
  "constraints": [...],
  "preferences": [...],
  "suggestedTools": [...],
  "requiredConnections": [...],
  "confidence": 0.X,
  "ambiguities": [...]
}
\`\`\``;

  protected readonly outputSchema = IntentOutputSchema;

  protected buildUserPrompt(context: AgentContext): string {
    const lastUserMsg = context.userMessages[context.userMessages.length - 1]?.content ?? "";
    const tools = context.availableTools;

    return `Parse the intent from this user goal:

## User's Goal:
"${lastUserMsg}"

## Currently Available MCP Tools (${tools.length}):
${tools.slice(0, 40).map(t => `- ${t.server}:${t.name} — ${t.description}`).join("\n") || "No tools discovered yet — suggest what would be needed"}

## Previous conversation (if any):
${context.userMessages.slice(0, -1).map(m => `${m.role}: ${m.content}`).join("\n") || "First message"}

Extract structured intent as JSON.`;
  }

  protected toAgentResult(parsed: unknown, context: AgentContext): AgentResult {
    const intent = parsed as z.infer<typeof IntentOutputSchema>;

    const parsedIntent: ParsedIntent = {
      rawInput: context.userMessages[context.userMessages.length - 1]?.content ?? "",
      goal: intent.goal,
      sourceDescription: intent.sourceDescription,
      targetDescription: intent.targetDescription,
      domain: intent.domain,
      constraints: intent.constraints,
      preferences: intent.preferences,
      suggestedTools: intent.suggestedTools,
      confidence: intent.confidence,
    };

    // Store required connections in context variables for downstream agents
    const needsClarification = intent.confidence < 0.7 || intent.ambiguities.length > 2;

    return {
      messages: [
        this.createMessage(
          "orchestrator",
          "response",
          `Intent parsed (confidence: ${intent.confidence}). Domain: ${intent.domain ?? "unknown"}. ${intent.requiredConnections.length} connections identified. ${intent.ambiguities.length} ambiguities.`,
          context,
          {
            intent: parsedIntent,
            requiredConnections: intent.requiredConnections,
            ambiguities: intent.ambiguities,
          },
        ),
      ],
      needsIteration: false,
      routeTo: needsClarification ? "clarifier" : "planner",
    };
  }
}
