import type { PipelineDefinition, PipelineNode } from "./pipeline.js";
import type { ToolDefinition } from "./mcp.js";

// ── Agent Roles ─────────────────────────────────────────────────────

export type AgentRole =
  | "orchestrator"
  | "planner"
  | "clarifier"
  | "architect"
  | "builder"
  | "validator"
  | "router";

// ── Orchestrator Phases ─────────────────────────────────────────────

export type OrchestratorPhase =
  | "clarifying"     // Gathering requirements via questions
  | "planning"       // Decomposing into sub-tasks
  | "architecting"   // Designing pipeline topology
  | "building"       // Generating pipeline definition
  | "validating"     // Checking correctness
  | "reviewing"      // User approval gate
  | "executing"      // Running the pipeline
  | "complete";

// ── Inter-Agent Messages ────────────────────────────────────────────

export interface AgentMessage {
  id: string;
  from: AgentRole;
  to: AgentRole | "user" | "broadcast";
  type: "request" | "response" | "question" | "clarification" | "critique" | "approval";
  content: string;
  payload?: unknown;
  timestamp: number;
  conversationId: string;
  correlationId?: string;
}

// ── Agent Context (shared state passed between agents) ──────────────

export interface AgentContext {
  conversationId: string;
  messages: AgentMessage[];
  userMessages: Array<{ role: "user" | "assistant"; content: string }>;
  currentIntent?: ParsedIntent;
  currentPlan?: TaskPlan;
  currentBlueprint?: PipelineBlueprint;
  currentPipeline?: PipelineDefinition;
  availableTools: ToolDefinition[];
  variables: Record<string, unknown>;
  iteration: number;
  maxIterations: number;
  phase: OrchestratorPhase;
}

// ── Agent Interface ─────────────────────────────────────────────────

export interface Agent {
  role: AgentRole;
  description: string;
  execute(context: AgentContext): Promise<AgentResult>;
}

export interface AgentResult {
  messages: AgentMessage[];
  updatedPipeline?: PipelineDefinition;
  updatedPlan?: TaskPlan;
  updatedBlueprint?: PipelineBlueprint;
  questionsForUser?: ClarificationQuestion[];
  needsIteration: boolean;
  routeTo?: AgentRole;
}

// ── Parsed Intent (output of intent parsing) ────────────────────────

export interface ParsedIntent {
  rawInput: string;
  goal: string;
  sourceDescription?: string;     // "Point A" — where we start
  targetDescription?: string;     // "Point B" — desired outcome
  constraints: string[];
  preferences: string[];
  suggestedTools: string[];
  domain?: string;                // e.g., "ci-cd", "data-processing", "content"
  confidence: number;             // 0–1
}

// ── Task Plan (output of PlannerAgent) ──────────────────────────────

export interface TaskPlan {
  goal: string;
  subTasks: SubTask[];
  dependencies: Array<{ from: number; to: number }>;
  assumptions: string[];
  openQuestions: string[];
}

export interface SubTask {
  index: number;
  description: string;
  requiredCapabilities: string[];
  estimatedComplexity: "low" | "medium" | "high";
}

// ── Pipeline Blueprint (output of ArchitectAgent) ───────────────────

export interface PipelineBlueprint {
  steps: BlueprintStep[];
  edges: Array<{ from: string; to: string; condition?: string }>;
  missingCapabilities: string[];
  notes: string[];
}

export interface BlueprintStep {
  id: string;
  name: string;
  description: string;
  type: PipelineNode["type"];
  toolHint: string;
  inputs: string[];
  outputs: string[];
}

// ── Validation Result (output of ValidatorAgent) ────────────────────

export interface ValidationResult {
  isValid: boolean;
  score: number;               // 0–100 quality score
  issues: ValidationIssue[];
  suggestions: string[];
}

export interface ValidationIssue {
  severity: "error" | "warning" | "info";
  stepId?: string;
  message: string;
  suggestedFix?: string;
}

// ── Clarification Questions (output of ClarifierAgent) ──────────────

export interface ClarificationQuestion {
  id: string;
  question: string;
  category: "scope" | "technology" | "constraint" | "preference" | "data" | "security";
  priority: "required" | "recommended" | "optional";
  options?: string[];
  defaultAnswer?: string;
}
