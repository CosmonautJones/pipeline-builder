// ── Schema (Zod schemas — the source of truth) ─────────────────────
export {
  PipelineDefinitionSchema,
  PipelineNodeSchema,
  PipelineEdgeSchema,
  PipelineMetadataSchema,
  PipelineVariableSchema,
  NodePortSchema,
  NodeTypeSchema,
  RetryPolicySchema,
  ErrorPolicySchema,
  HumanReviewConfigSchema,
  TriggerSchema,
  McpServerRefSchema,
  TimeoutPolicySchema,
} from "./schema/index.js";

// ── Types (inferred from schemas) ───────────────────────────────────
export type {
  PipelineDefinition,
  PipelineNode,
  PipelineEdge,
  PipelineMetadata,
  PipelineVariable,
  NodePort,
  NodeType,
  RetryPolicy,
  ErrorPolicy,
  HumanReviewConfig,
  Trigger,
  McpServerRef,
  TimeoutPolicy,
} from "./types/index.js";

export type {
  AgentRole,
  AgentMessage,
  AgentContext,
  AgentResult,
  Agent,
  TaskPlan,
  SubTask,
  PipelineBlueprint,
  BlueprintStep,
  ValidationResult,
  ValidationIssue,
  ClarificationQuestion,
  ParsedIntent,
  OrchestratorPhase,
} from "./types/index.js";

export type {
  NodeExecutionStatus,
  NodeExecutionState,
  PipelineExecutionState,
  PipelineStatus,
  ExecutionEvent,
  ExecutionOptions,
} from "./types/index.js";

export type {
  McpServerConfig,
  ToolDefinition,
  ToolInvocation,
  ToolResult,
} from "./types/index.js";

// ── DAG Engine ──────────────────────────────────────────────────────
export { DAG, buildDAGFromPipeline, validatePipelineDAG } from "./dag/index.js";
export type { DAGNode, DAGEdge, DAGValidationResult } from "./dag/index.js";

// ── Agent System ────────────────────────────────────────────────────
export { Orchestrator, AnthropicProvider, BaseAgent } from "./agents/index.js";
export type { LLMProvider, OrchestratorConfig, OrchestratorCallbacks } from "./agents/index.js";
export { ClarifierAgent } from "./agents/clarifier/index.js";
export { PlannerAgent } from "./agents/planner/index.js";
export { ArchitectAgent } from "./agents/architect/index.js";
export { BuilderAgent } from "./agents/builder/index.js";
export { ValidatorAgent } from "./agents/validator/index.js";
export { RouterAgent } from "./agents/router/index.js";

// ── Execution Engine ────────────────────────────────────────────────
export { PipelineRuntime, StateManager, Scheduler, CheckpointManager } from "./engine/index.js";
export type { StepHandler, Checkpoint } from "./engine/index.js";

// ── MCP Integration ─────────────────────────────────────────────────
export { MCPClientManager, MCPServerInstaller } from "./mcp/index.js";

// ── Conversation ────────────────────────────────────────────────────
export { ConversationSession, AutoApproveInterface } from "./conversation/index.js";
export type { HumanInterface, ConversationMessage } from "./conversation/index.js";

// ── Templates ───────────────────────────────────────────────────────
export { TemplateRegistry } from "./templates/index.js";

// ── Integrations (Claude Code, Cursor, MCP Server) ─────────────────
export { startMCPServer } from "./integrations/mcp-server.js";
export { generateClaudeMd, exportClaudeMd } from "./integrations/claude-md-export.js";
export { generateCursorRules, exportCursorRules } from "./integrations/cursor-rules-export.js";
export { generateClaudeCodeHooks, exportClaudeCodeHooks } from "./integrations/claude-code-hooks.js";
export type { ClaudeCodeSettings, ClaudeCodeHook } from "./integrations/claude-code-hooks.js";

// ── Persistence ─────────────────────────────────────────────────────
export { PipelineStore } from "./persistence/index.js";

// ── Utilities ───────────────────────────────────────────────────────
export {
  generateId,
  generateExecutionId,
  generateConversationId,
  TypedEventBus,
  PipelineBuilderError,
  DAGCycleError,
  DAGValidationError,
  StepExecutionError,
  ToolNotFoundError,
  MCPConnectionError,
} from "./utils/index.js";
