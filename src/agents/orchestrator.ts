import type {
  Agent,
  AgentRole,
  AgentContext,
  AgentResult,
  OrchestratorPhase,
  ParsedIntent,
  ClarificationQuestion,
} from "../types/agent.js";
import type { PipelineDefinition } from "../types/pipeline.js";
import type { ToolDefinition } from "../types/mcp.js";
import { generateConversationId } from "../utils/id.js";
import { createChildLogger } from "../utils/logger.js";
import type { LLMProvider } from "./base-agent.js";
import { ClarifierAgent } from "./clarifier/index.js";
import { PlannerAgent } from "./planner/index.js";
import { ArchitectAgent } from "./architect/index.js";
import { BuilderAgent } from "./builder/index.js";
import { ValidatorAgent } from "./validator/index.js";
import { RouterAgent } from "./router/index.js";

export interface OrchestratorConfig {
  maxIterationsPerPhase: number;
  maxTotalIterations: number;
  autoAdvance: boolean;      // Auto-advance phases or wait for user approval
}

export interface OrchestratorCallbacks {
  onPhaseChange?: (phase: OrchestratorPhase) => void;
  onQuestionsForUser?: (questions: ClarificationQuestion[]) => Promise<string>;
  onPipelineReady?: (pipeline: PipelineDefinition) => Promise<"approve" | "modify" | "reject">;
  onLog?: (message: string) => void;
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  maxIterationsPerPhase: 3,
  maxTotalIterations: 15,
  autoAdvance: true,
};

/**
 * The Orchestrator coordinates the multi-agent pipeline design process.
 *
 * Flow: Intent → Clarify → Plan → Architect → Build → Validate → Review
 *
 * Each phase can iterate (e.g., validator sends pipeline back to builder for fixes)
 * and the orchestrator manages the overall state machine.
 */
export class Orchestrator {
  private agents: Map<AgentRole, Agent>;
  private context: AgentContext;
  private config: OrchestratorConfig;
  private callbacks: OrchestratorCallbacks;
  private logger = createChildLogger("Orchestrator");
  private totalIterations = 0;

  constructor(
    llm: LLMProvider,
    config?: Partial<OrchestratorConfig>,
    callbacks?: OrchestratorCallbacks,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.callbacks = callbacks ?? {};

    // Initialize all agents
    this.agents = new Map<AgentRole, Agent>([
      ["clarifier", new ClarifierAgent(llm)],
      ["planner", new PlannerAgent(llm)],
      ["architect", new ArchitectAgent(llm)],
      ["builder", new BuilderAgent(llm)],
      ["validator", new ValidatorAgent(llm)],
      ["router", new RouterAgent(llm)],
    ]);

    // Initialize context
    this.context = {
      conversationId: generateConversationId(),
      messages: [],
      userMessages: [],
      availableTools: [],
      variables: {},
      iteration: 0,
      maxIterations: this.config.maxIterationsPerPhase,
      phase: "clarifying",
    };
  }

  /**
   * Main entry point: takes a user's goal and orchestrates the full
   * pipeline design process.
   */
  async designPipeline(
    userGoal: string,
    options?: {
      tools?: ToolDefinition[];
      intent?: ParsedIntent;
    },
  ): Promise<PipelineDefinition | null> {
    this.log(`Starting pipeline design for: "${userGoal}"`);

    // Seed context
    this.context.userMessages.push({ role: "user", content: userGoal });
    if (options?.tools) this.context.availableTools = options.tools;
    if (options?.intent) this.context.currentIntent = options.intent;

    // Parse intent if not provided
    if (!this.context.currentIntent) {
      this.context.currentIntent = this.quickParseIntent(userGoal);
    }

    // Main orchestration loop
    let currentAgent: AgentRole = "clarifier";

    while (this.totalIterations < this.config.maxTotalIterations) {
      this.totalIterations++;
      this.context.iteration++;

      const agent = this.agents.get(currentAgent);
      if (!agent) {
        this.log(`Unknown agent: ${currentAgent}`);
        break;
      }

      this.setPhase(this.agentToPhase(currentAgent));
      this.log(`[${this.totalIterations}/${this.config.maxTotalIterations}] Running ${currentAgent} agent (phase: ${this.context.phase})`);

      const result = await agent.execute(this.context);
      this.applyResult(result);

      // Handle questions for user
      if (result.questionsForUser && result.questionsForUser.length > 0) {
        const userResponse = await this.askUser(result.questionsForUser);
        if (userResponse) {
          this.context.userMessages.push({ role: "user", content: userResponse });
        }
      }

      // Check if we've reached the review phase
      if (this.context.currentPipeline && currentAgent === "validator" && !result.needsIteration) {
        const decision = await this.reviewPipeline(this.context.currentPipeline);
        if (decision === "approve") {
          this.setPhase("complete");
          return this.context.currentPipeline;
        } else if (decision === "reject") {
          this.log("User rejected pipeline");
          return null;
        }
        // "modify" → continue iteration
        currentAgent = "builder";
        continue;
      }

      // Determine next agent
      if (result.routeTo) {
        currentAgent = result.routeTo;
      } else if (result.needsIteration) {
        // Stay with current agent or use router
        if (this.context.iteration >= this.config.maxIterationsPerPhase) {
          this.log(`Max iterations for ${currentAgent} reached, advancing`);
          currentAgent = this.advancePhase(currentAgent);
          this.context.iteration = 0;
        }
      } else {
        currentAgent = this.advancePhase(currentAgent);
        this.context.iteration = 0;
      }
    }

    this.log("Max total iterations reached");
    return this.context.currentPipeline ?? null;
  }

  // ── Internal helpers ────────────────────────────────────────────

  private applyResult(result: AgentResult): void {
    this.context.messages.push(...result.messages);
    if (result.updatedPipeline) this.context.currentPipeline = result.updatedPipeline;
    if (result.updatedPlan) this.context.currentPlan = result.updatedPlan;
    if (result.updatedBlueprint) this.context.currentBlueprint = result.updatedBlueprint;
  }

  private agentToPhase(agent: AgentRole): OrchestratorPhase {
    const map: Record<AgentRole, OrchestratorPhase> = {
      orchestrator: "clarifying",
      clarifier: "clarifying",
      planner: "planning",
      architect: "architecting",
      builder: "building",
      validator: "validating",
      router: "clarifying",
    };
    return map[agent];
  }

  private advancePhase(current: AgentRole): AgentRole {
    const progression: AgentRole[] = ["clarifier", "planner", "architect", "builder", "validator"];
    const idx = progression.indexOf(current);
    if (idx === -1 || idx === progression.length - 1) return "validator";
    return progression[idx + 1];
  }

  private setPhase(phase: OrchestratorPhase): void {
    if (this.context.phase !== phase) {
      this.context.phase = phase;
      this.callbacks.onPhaseChange?.(phase);
    }
  }

  private async askUser(questions: ClarificationQuestion[]): Promise<string | null> {
    if (!this.callbacks.onQuestionsForUser) return null;
    const formatted = questions.map(q =>
      `[${q.priority}] ${q.question}${q.options ? `\n  Options: ${q.options.join(", ")}` : ""}`
    ).join("\n\n");
    return this.callbacks.onQuestionsForUser(questions);
  }

  private async reviewPipeline(pipeline: PipelineDefinition): Promise<"approve" | "modify" | "reject"> {
    if (!this.callbacks.onPipelineReady) return "approve";
    return this.callbacks.onPipelineReady(pipeline);
  }

  private quickParseIntent(input: string): ParsedIntent {
    return {
      rawInput: input,
      goal: input,
      constraints: [],
      preferences: [],
      suggestedTools: [],
      confidence: 0.5,
    };
  }

  private log(message: string): void {
    this.logger.info(message);
    this.callbacks.onLog?.(message);
  }

  // ── Public accessors ────────────────────────────────────────────

  getContext(): AgentContext {
    return { ...this.context };
  }

  getCurrentPhase(): OrchestratorPhase {
    return this.context.phase;
  }

  getCurrentPipeline(): PipelineDefinition | undefined {
    return this.context.currentPipeline;
  }
}
