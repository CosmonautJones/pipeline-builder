import { describe, it, expect, vi } from "vitest";
import { Orchestrator } from "../../../src/agents/orchestrator.js";
import type { LLMProvider } from "../../../src/agents/base-agent.js";

/**
 * Mock LLM that returns canned responses based on what the system prompt contains.
 * This lets us test the orchestrator's routing and coordination without calling Claude.
 */
function createMockLLM(): LLMProvider {
  return {
    complete: vi.fn(async (systemPrompt: string, _messages: Array<{ role: string; content: string }>) => {
      // Intent parser
      if (systemPrompt.includes("Intent Parser")) {
        return JSON.stringify({
          goal: "Build a CI pipeline",
          sourceDescription: "Code in GitHub",
          targetDescription: "Deployed application",
          domain: "ci-cd",
          constraints: [],
          preferences: [],
          suggestedTools: ["github", "shell"],
          requiredConnections: [
            { system: "GitHub", purpose: "fetch code", connectionType: "api" },
          ],
          confidence: 0.9,
          ambiguities: [],
        });
      }

      // Clarifier
      if (systemPrompt.includes("Clarifier Agent")) {
        return JSON.stringify({
          questions: [],
          hasEnoughContext: true,
          summary: "Goal is clear enough to proceed",
        });
      }

      // Planner
      if (systemPrompt.includes("Planner Agent")) {
        return JSON.stringify({
          goal: "Build a CI pipeline",
          subTasks: [
            { index: 0, description: "Checkout code", requiredCapabilities: ["git"], estimatedComplexity: "low" },
            { index: 1, description: "Run tests", requiredCapabilities: ["shell"], estimatedComplexity: "low" },
          ],
          dependencies: [{ from: 0, to: 1 }],
          assumptions: ["Tests use npm"],
          openQuestions: [],
        });
      }

      // Architect
      if (systemPrompt.includes("Architect Agent")) {
        return JSON.stringify({
          steps: [
            { id: "checkout", name: "Checkout", description: "Get code", type: "trigger", toolHint: "git:checkout", inputs: [], outputs: ["code"] },
            { id: "test", name: "Test", description: "Run tests", type: "action", toolHint: "shell:exec", inputs: ["code"], outputs: ["results"] },
          ],
          edges: [{ from: "checkout", to: "test" }],
          missingCapabilities: [],
          notes: [],
        });
      }

      // Builder
      if (systemPrompt.includes("Builder Agent")) {
        return JSON.stringify({
          apiVersion: "pipeline-builder/v1",
          metadata: { name: "CI Pipeline", version: "1.0.0", tags: ["ci"] },
          nodes: [
            { id: "checkout", name: "Checkout", type: "trigger", dependsOn: [], inputs: [], outputs: [], inputMappings: {}, errorPolicy: "fail", tags: [], metadata: {} },
            { id: "test", name: "Test", type: "action", tool: "shell:exec", toolInput: { command: "npm test" }, dependsOn: ["checkout"], inputs: [], outputs: [], inputMappings: {}, errorPolicy: "fail", tags: [], metadata: {} },
          ],
          edges: [{ from: "checkout", to: "test" }],
          variables: [],
          secrets: [],
          env: {},
          trigger: { type: "manual", config: {} },
          mcpServers: [],
          tags: ["ci"],
        });
      }

      // Validator
      if (systemPrompt.includes("Validator Agent")) {
        return JSON.stringify({
          isValid: true,
          score: 85,
          issues: [],
          suggestions: ["Consider adding retry policy to test step"],
        });
      }

      // Router
      if (systemPrompt.includes("Router Agent")) {
        return JSON.stringify({
          routeTo: "validator",
          reasoning: "Pipeline exists, needs validation",
          contextSummary: "Pipeline is built",
        });
      }

      return "{}";
    }),
  };
}

describe("Orchestrator", () => {
  it("should design a pipeline end-to-end with mock LLM", async () => {
    const llm = createMockLLM();
    const phases: string[] = [];

    const orchestrator = new Orchestrator(llm, {
      useRouter: false, // Use deterministic progression for this test
      maxTotalIterations: 20,
    }, {
      onPhaseChange: (phase) => phases.push(phase),
      onPipelineReady: async () => "approve",
    });

    const pipeline = await orchestrator.designPipeline("Build a CI pipeline");

    expect(pipeline).not.toBeNull();
    expect(pipeline!.metadata.name).toBe("CI Pipeline");
    expect(pipeline!.nodes.length).toBe(2);

    // Should have gone through key phases
    // Note: high confidence (0.9) skips clarifying and goes straight to planning
    expect(phases).toContain("planning");
    expect(phases).toContain("architecting");
    expect(phases).toContain("building");
    expect(phases).toContain("validating");
    expect(phases).toContain("complete");
  });

  it("should return null when user rejects", async () => {
    const llm = createMockLLM();

    const orchestrator = new Orchestrator(llm, {
      useRouter: false,
    }, {
      onPipelineReady: async () => "reject",
    });

    const pipeline = await orchestrator.designPipeline("Build something");
    expect(pipeline).toBeNull();
  });

  it("should pass questions to user callback", async () => {
    const questionsLLM: LLMProvider = {
      complete: vi.fn(async (systemPrompt: string) => {
        if (systemPrompt.includes("Intent Parser")) {
          return JSON.stringify({
            goal: "Deploy app",
            domain: "deployment",
            constraints: [],
            preferences: [],
            suggestedTools: [],
            requiredConnections: [],
            confidence: 0.4, // Low confidence → will clarify
            ambiguities: ["Which cloud provider?"],
          });
        }
        if (systemPrompt.includes("Clarifier")) {
          return JSON.stringify({
            questions: [
              { id: "q1", question: "Which cloud?", category: "technology", priority: "required", options: ["AWS", "GCP"] },
            ],
            hasEnoughContext: false,
            summary: "Need cloud provider info",
          });
        }
        // After clarification, return enough context
        if (systemPrompt.includes("Planner")) {
          return JSON.stringify({
            goal: "Deploy app to AWS",
            subTasks: [{ index: 0, description: "Deploy", requiredCapabilities: ["aws"], estimatedComplexity: "medium" }],
            dependencies: [],
            assumptions: [],
            openQuestions: [],
          });
        }
        if (systemPrompt.includes("Architect")) {
          return JSON.stringify({
            steps: [{ id: "deploy", name: "Deploy", description: "Deploy to AWS", type: "action", toolHint: "aws:deploy", inputs: [], outputs: [] }],
            edges: [],
            missingCapabilities: [],
            notes: [],
          });
        }
        if (systemPrompt.includes("Builder")) {
          return JSON.stringify({
            apiVersion: "pipeline-builder/v1",
            metadata: { name: "Deploy", version: "1.0.0", tags: [] },
            nodes: [{ id: "deploy", name: "Deploy", type: "action", tool: "shell:exec", toolInput: { command: "aws deploy" }, dependsOn: [], inputs: [], outputs: [], inputMappings: {}, errorPolicy: "fail", tags: [], metadata: {} }],
            edges: [],
            variables: [],
            secrets: [],
            env: {},
            trigger: { type: "manual", config: {} },
            mcpServers: [],
            tags: [],
          });
        }
        if (systemPrompt.includes("Validator")) {
          return JSON.stringify({ isValid: true, score: 80, issues: [], suggestions: [] });
        }
        return "{}";
      }),
    };

    let questionsReceived = false;

    const orchestrator = new Orchestrator(questionsLLM, {
      useRouter: false,
    }, {
      onQuestionsForUser: async (questions) => {
        questionsReceived = true;
        expect(questions.length).toBeGreaterThan(0);
        return "AWS";
      },
      onPipelineReady: async () => "approve",
    });

    const pipeline = await orchestrator.designPipeline("Deploy my app");
    expect(questionsReceived).toBe(true);
    expect(pipeline).not.toBeNull();
  });

  it("should respect max iterations", async () => {
    let callCount = 0;
    const infiniteLoopLLM: LLMProvider = {
      complete: vi.fn(async (systemPrompt: string) => {
        callCount++;
        if (systemPrompt.includes("Intent Parser")) {
          return JSON.stringify({
            goal: "test",
            domain: "other",
            constraints: [],
            preferences: [],
            suggestedTools: [],
            requiredConnections: [],
            confidence: 0.3,
            ambiguities: ["everything"],
          });
        }
        if (systemPrompt.includes("Clarifier")) {
          return JSON.stringify({
            questions: [{ id: "q1", question: "What?", category: "scope", priority: "required" }],
            hasEnoughContext: false,
            summary: "Still unclear",
          });
        }
        // Planner gets called after clarifier hits max iterations
        if (systemPrompt.includes("Planner")) {
          return JSON.stringify({
            goal: "test", subTasks: [], dependencies: [], assumptions: [], openQuestions: ["still unclear"],
          });
        }
        if (systemPrompt.includes("Architect")) {
          return JSON.stringify({ steps: [], edges: [], missingCapabilities: [], notes: [] });
        }
        if (systemPrompt.includes("Builder")) {
          // Return invalid pipeline on purpose (no nodes) to keep iterating
          return JSON.stringify({
            apiVersion: "pipeline-builder/v1",
            metadata: { name: "test", version: "1.0.0", tags: [] },
            nodes: [{ id: "a", name: "A", type: "action", tool: "t:t", dependsOn: [], inputs: [], outputs: [], inputMappings: {}, errorPolicy: "fail", tags: [], metadata: {} }],
            edges: [], variables: [], secrets: [], env: {}, trigger: { type: "manual", config: {} }, mcpServers: [], tags: [],
          });
        }
        if (systemPrompt.includes("Validator")) {
          return JSON.stringify({ isValid: false, score: 20, issues: [{ severity: "error", message: "Bad" }], suggestions: [] });
        }
        return "{}";
      }),
    };

    const orchestrator = new Orchestrator(infiniteLoopLLM, {
      useRouter: false,
      maxTotalIterations: 8,
      maxIterationsPerPhase: 2,
    }, {
      onQuestionsForUser: async () => "I don't know",
    });

    const result = await orchestrator.designPipeline("Something vague");
    // Should terminate within max iterations and return whatever it has
    expect(callCount).toBeLessThanOrEqual(12); // intent + max iterations + some overhead
  });

  it("should expose current phase and context", () => {
    const llm = createMockLLM();
    const orchestrator = new Orchestrator(llm);

    expect(orchestrator.getCurrentPhase()).toBe("clarifying");
    expect(orchestrator.getContext().conversationId).toBeTruthy();
  });
});
