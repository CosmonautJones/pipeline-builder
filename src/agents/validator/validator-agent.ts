import { z } from "zod";
import { BaseAgent } from "../base-agent.js";
import type { AgentRole, AgentContext, AgentResult, ValidationResult } from "../../types/agent.js";
import { buildDAGFromPipeline, validatePipelineDAG } from "../../dag/index.js";

const ValidatorOutputSchema = z.object({
  isValid: z.boolean(),
  score: z.number().min(0).max(100),
  issues: z.array(z.object({
    severity: z.enum(["error", "warning", "info"]),
    stepId: z.string().optional(),
    message: z.string(),
    suggestedFix: z.string().optional(),
  })),
  suggestions: z.array(z.string()),
});

export class ValidatorAgent extends BaseAgent {
  readonly role: AgentRole = "validator";
  readonly description = "Critiques pipeline designs for correctness, completeness, and best practices";

  protected readonly systemPrompt = `You are the Validator Agent in an agentic pipeline builder system.

Your job is to critically review a pipeline definition and identify issues, risks, and improvements.

## Validation checks:
1. **Structural**: DAG validity (no cycles), all edges reference existing nodes
2. **Completeness**: All action nodes have tools, all required inputs are mapped
3. **Security**: No hardcoded secrets, proper access control, human gates before destructive ops
4. **Reliability**: Retry policies on network operations, timeouts on long operations
5. **Data flow**: Outputs of upstream nodes match expected inputs of downstream nodes
6. **Best practices**: Meaningful names, descriptions, proper error policies
7. **Efficiency**: Unnecessary sequential steps that could be parallel, redundant operations

## Scoring:
- 90-100: Production-ready
- 70-89: Good, minor improvements possible
- 50-69: Functional but needs attention
- 30-49: Significant issues to address
- 0-29: Not viable, needs redesign

## Issue severities:
- error: Must be fixed — pipeline will fail or produce wrong results
- warning: Should be fixed — reliability or security concern
- info: Nice to fix — readability or best practice improvement

Return your review as JSON:
\`\`\`json
{
  "isValid": boolean,
  "score": number,
  "issues": [...],
  "suggestions": [...]
}
\`\`\``;

  protected readonly outputSchema = ValidatorOutputSchema;

  async execute(context: AgentContext): Promise<AgentResult> {
    // Run structural validation first (doesn't need LLM)
    const structuralIssues = this.runStructuralValidation(context);

    // Then run LLM-based semantic validation
    const llmResult = await super.execute(context);

    // Merge structural issues into the LLM result
    if (structuralIssues.length > 0 && llmResult.messages[0]?.payload) {
      const payload = llmResult.messages[0].payload as { validationResult: ValidationResult };
      if (payload.validationResult) {
        payload.validationResult.issues = [
          ...structuralIssues.map(msg => ({
            severity: "error" as const,
            message: msg,
          })),
          ...payload.validationResult.issues,
        ];
        if (structuralIssues.length > 0) {
          payload.validationResult.isValid = false;
        }
      }
    }

    return llmResult;
  }

  private runStructuralValidation(context: AgentContext): string[] {
    const pipeline = context.currentPipeline;
    if (!pipeline) return ["No pipeline definition to validate"];

    try {
      const dag = buildDAGFromPipeline(pipeline);
      const result = validatePipelineDAG(dag, pipeline);
      return result.errors;
    } catch (e) {
      return [e instanceof Error ? e.message : "Unknown DAG error"];
    }
  }

  protected buildUserPrompt(context: AgentContext): string {
    const pipeline = context.currentPipeline;

    return `Review this pipeline definition for correctness, security, and best practices:

## Pipeline Definition:
\`\`\`json
${JSON.stringify(pipeline, null, 2)}
\`\`\`

## Original Goal:
${context.currentIntent?.goal ?? "Not specified"}

## Task Plan:
${context.currentPlan ? JSON.stringify(context.currentPlan, null, 2) : "Not available"}

Provide a comprehensive review as JSON.`;
  }

  protected toAgentResult(parsed: unknown, context: AgentContext): AgentResult {
    const validation = parsed as ValidationResult;

    const needsIteration = !validation.isValid || validation.score < 70;

    return {
      messages: [
        this.createMessage(
          "orchestrator",
          "critique",
          `Validation ${validation.isValid ? "PASSED" : "FAILED"} (score: ${validation.score}/100). ${validation.issues.length} issues found.`,
          context,
          { validationResult: validation },
        ),
      ],
      needsIteration,
      routeTo: needsIteration ? "builder" : undefined,
    };
  }
}
