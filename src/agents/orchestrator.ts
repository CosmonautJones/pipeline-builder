import type {
  Agent,
  AgentRole,
  AgentContext,
  AgentResult,
  OrchestratorPhase,
  ParsedIntent,
  ClarificationQuestion,
  RequiredConnection,
} from "../types/agent.js";
import type { PipelineDefinition } from "../types/pipeline.js";
import type { ToolDefinition } from "../types/mcp.js";
import { generateConversationId } from "../utils/id.js";
import { createChildLogger } from "../utils/logger.js";
import type { LLMProvider } from "./base-agent.js";
import { IntentParserAgent } from "./intent-parser/index.js";
import { ClarifierAgent } from "./clarifier/index.js";
import { PlannerAgent } from "./planner/index.js";
import { ArchitectAgent } from "./architect/index.js";
import { BuilderAgent } from "./builder/index.js";
import { ValidatorAgent } from "./validator/index.js";
import { RouterAgent } from "./router/index.js";
import { ToolDiscoveryAgent } from "./discovery/index.js";

export interface OrchestratorConfig {
  maxIterationsPerPhase: number;
  maxTotalIterations: number;
  useRouter: boolean;            // Use RouterAgent for dynamic routing
}

export interface OrchestratorCallbacks {
  onPhaseChange?: (phase: OrchestratorPhase) => void;
  onQuestionsForUser?: (questions: ClarificationQuestion[]) => Promise<string>;
  onPipelineReady?: (pipeline: PipelineDefinition) => Promise<"approve" | "modify" | "reject">;
  onConnectionDiscovered?: (connections: RequiredConnection[]) => void;
  onLog?: (message: string) => void;
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  maxIterationsPerPhase: 3,
  maxTotalIterations: 20,
  useRouter: true,
};

/**
 * The Orchestrator coordinates the multi-agent pipeline design process.
 *
 * Flow: Intent Parse → Clarify → Plan → Architect → [Discover] → Build → Validate → Review
 *
 * Key differences from v1:
 * - Real LLM-based intent parsing (not a stub)
 * - Dynamic routing via RouterAgent (not hard-coded progression)
 * - Feedback loops that pass structured critique back to agents
 * - Connection discovery that identifies what systems the pipeline needs
 */
export class Orchestrator {
  private agents: Map<AgentRole, Agent>;
  private intentParser: IntentParserAgent;
  private context: AgentContext;
  private config: OrchestratorConfig;
  private callbacks: OrchestratorCallbacks;
  private logger = createChildLogger("Orchestrator");
  private totalIterations = 0;
  private phaseIterations = new Map<string, number>();

  constructor(
    private llm: LLMProvider,
    config?: Partial<OrchestratorConfig>,
    callbacks?: OrchestratorCallbacks,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.callbacks = callbacks ?? {};

    // Initialize the intent parser (runs before the main loop)
    this.intentParser = new IntentParserAgent(llm);

    // Initialize all specialist agents
    this.agents = new Map<AgentRole, Agent>([
      ["clarifier", new ClarifierAgent(llm)],
      ["planner", new PlannerAgent(llm)],
      ["architect", new ArchitectAgent(llm)],
      ["discovery", new ToolDiscoveryAgent(llm)],
      ["builder", new BuilderAgent(llm)],
      ["validator", new ValidatorAgent(llm)],
      ["router", new RouterAgent(llm)],
    ]);

    // Initialize context
    this.context = this.freshContext();
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

    // Phase 0: Parse intent (LLM-based, not a stub)
    if (options?.intent) {
      this.context.currentIntent = options.intent;
      this.log(`Using provided intent (confidence: ${options.intent.confidence})`);
    } else {
      this.setPhase("clarifying");
      this.log("Parsing intent with LLM...");
      const intentResult = await this.intentParser.execute(this.context);
      this.applyResult(intentResult);

      // Extract required connections from intent result payload
      const payload = intentResult.messages[0]?.payload as {
        intent?: ParsedIntent;
        requiredConnections?: RequiredConnection[];
        ambiguities?: string[];
      } | undefined;

      if (payload?.intent) {
        this.context.currentIntent = payload.intent;
        if (payload.requiredConnections) {
          this.context.requiredConnections = payload.requiredConnections;
          this.callbacks.onConnectionDiscovered?.(payload.requiredConnections);
          this.log(`Identified ${payload.requiredConnections.length} required connections: ${payload.requiredConnections.map(c => c.system).join(", ")}`);
        }
      }
    }

    // Determine first agent based on intent confidence
    let currentAgent: AgentRole = this.determineFirstAgent();
    this.log(`Intent confidence: ${this.context.currentIntent?.confidence ?? 0}. Starting with: ${currentAgent}`);

    // Main orchestration loop
    while (this.totalIterations < this.config.maxTotalIterations) {
      this.totalIterations++;
      this.context.iteration++;
      this.incrementPhaseIterations(currentAgent);

      const agent = this.agents.get(currentAgent);
      if (!agent) {
        this.log(`Unknown agent: ${currentAgent}, using router`);
        currentAgent = await this.routeWithRouter();
        continue;
      }

      this.setPhase(this.agentToPhase(currentAgent));
      this.log(`[${this.totalIterations}/${this.config.maxTotalIterations}] ${currentAgent} (phase: ${this.context.phase}, iter: ${this.getPhaseIterations(currentAgent)})`);

      // Execute agent
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
        // "modify" → capture feedback and route back
        this.context.feedbackHistory.push(
          `User requested modifications after validation. Last validator message: ${result.messages[result.messages.length - 1]?.content ?? "none"}`
        );
        currentAgent = await this.determineNextAgent(result, currentAgent);
        continue;
      }

      // Determine next agent
      currentAgent = await this.determineNextAgent(result, currentAgent);
    }

    this.log("Max total iterations reached");
    return this.context.currentPipeline ?? null;
  }

  // ── Routing ─────────────────────────────────────────────────────

  /**
   * Determine the next agent to run. Uses RouterAgent for dynamic
   * decisions when enabled, falls back to structured progression.
   */
  private async determineNextAgent(result: AgentResult, current: AgentRole): Promise<AgentRole> {
    // If the agent explicitly says where to go, respect it
    if (result.routeTo) {
      this.resetPhaseIterations(result.routeTo);
      return result.routeTo;
    }

    // If iteration is needed but we've hit the phase limit, force advance
    if (result.needsIteration) {
      if (this.getPhaseIterations(current) >= this.config.maxIterationsPerPhase) {
        this.log(`Max iterations for ${current}, advancing`);
        return this.fallbackAdvance(current);
      }
      // Stay with current agent
      return current;
    }

    // Use RouterAgent for dynamic routing when enabled
    if (this.config.useRouter) {
      return this.routeWithRouter();
    }

    // Fallback: structured progression
    return this.fallbackAdvance(current);
  }

  /**
   * Use the RouterAgent to dynamically decide the next step.
   */
  private async routeWithRouter(): Promise<AgentRole> {
    try {
      const router = this.agents.get("router")!;
      const routerResult = await router.execute(this.context);
      this.applyResult(routerResult);

      if (routerResult.routeTo) {
        this.log(`Router → ${routerResult.routeTo}: ${routerResult.messages[0]?.content ?? ""}`);
        return routerResult.routeTo;
      }
    } catch (e) {
      this.log(`Router failed, using fallback: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Fallback if router fails
    return this.inferNextFromContext();
  }

  /**
   * Determine first agent based on intent confidence.
   */
  private determineFirstAgent(): AgentRole {
    const confidence = this.context.currentIntent?.confidence ?? 0;
    if (confidence >= 0.85) return "planner";   // Very clear → skip clarification
    if (confidence >= 0.7) return "clarifier";  // Minor questions
    return "clarifier";                          // Needs clarification
  }

  /**
   * Infer next agent from what exists in context.
   */
  private inferNextFromContext(): AgentRole {
    if (!this.context.currentIntent) return "clarifier";
    if (!this.context.currentPlan) return "planner";
    if (!this.context.currentBlueprint) return "architect";
    // Route to discovery if blueprint has missing capabilities
    if (this.context.currentBlueprint?.missingCapabilities?.length && !this.context.currentPipeline) return "discovery";
    if (!this.context.currentPipeline) return "builder";
    return "validator";
  }

  /**
   * Structured progression fallback.
   */
  private fallbackAdvance(current: AgentRole): AgentRole {
    const progression: AgentRole[] = ["clarifier", "planner", "architect", "discovery", "builder", "validator"];
    const idx = progression.indexOf(current);
    if (idx === -1 || idx >= progression.length - 1) return "validator";
    const next = progression[idx + 1];
    this.resetPhaseIterations(next);
    return next;
  }

  // ── State management ────────────────────────────────────────────

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
      discovery: "discovering",
      builder: "building",
      validator: "validating",
      router: "clarifying",
    };
    return map[agent];
  }

  private setPhase(phase: OrchestratorPhase): void {
    if (this.context.phase !== phase) {
      this.context.phase = phase;
      this.callbacks.onPhaseChange?.(phase);
    }
  }

  // ── Phase iteration tracking ────────────────────────────────────

  private incrementPhaseIterations(agent: AgentRole): void {
    const count = this.phaseIterations.get(agent) ?? 0;
    this.phaseIterations.set(agent, count + 1);
  }

  private getPhaseIterations(agent: AgentRole): number {
    return this.phaseIterations.get(agent) ?? 0;
  }

  private resetPhaseIterations(agent: AgentRole): void {
    this.phaseIterations.set(agent, 0);
  }

  // ── User interaction ────────────────────────────────────────────

  private async askUser(questions: ClarificationQuestion[]): Promise<string | null> {
    if (!this.callbacks.onQuestionsForUser) return null;
    return this.callbacks.onQuestionsForUser(questions);
  }

  private async reviewPipeline(pipeline: PipelineDefinition): Promise<"approve" | "modify" | "reject"> {
    if (!this.callbacks.onPipelineReady) return "approve";
    return this.callbacks.onPipelineReady(pipeline);
  }

  private freshContext(): AgentContext {
    return {
      conversationId: generateConversationId(),
      messages: [],
      userMessages: [],
      availableTools: [],
      requiredConnections: [],
      feedbackHistory: [],
      variables: {},
      iteration: 0,
      maxIterations: this.config.maxIterationsPerPhase,
      phase: "clarifying",
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
