export class PipelineBuilderError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = "PipelineBuilderError";
  }
}

export class DAGCycleError extends PipelineBuilderError {
  constructor(public cycle: string[]) {
    super(`Cycle detected in pipeline: ${cycle.join(" → ")}`, "DAG_CYCLE");
    this.name = "DAGCycleError";
  }
}

export class DAGValidationError extends PipelineBuilderError {
  constructor(message: string, public nodeId?: string) {
    super(message, "DAG_VALIDATION");
    this.name = "DAGValidationError";
  }
}

export class StepExecutionError extends PipelineBuilderError {
  constructor(message: string, public stepId: string, public cause?: Error) {
    super(message, "STEP_EXECUTION");
    this.name = "StepExecutionError";
  }
}

export class ToolNotFoundError extends PipelineBuilderError {
  constructor(public toolName: string) {
    super(`Tool not found: ${toolName}`, "TOOL_NOT_FOUND");
    this.name = "ToolNotFoundError";
  }
}

export class MCPConnectionError extends PipelineBuilderError {
  constructor(public serverName: string, cause?: string) {
    super(`Failed to connect to MCP server "${serverName}": ${cause ?? "unknown"}`, "MCP_CONNECTION");
    this.name = "MCPConnectionError";
  }
}

export class PipelineTimeoutError extends PipelineBuilderError {
  constructor(public executionId: string, public timeoutMs: number) {
    super(`Pipeline execution ${executionId} timed out after ${timeoutMs}ms`, "PIPELINE_TIMEOUT");
    this.name = "PipelineTimeoutError";
  }
}

export class AgentError extends PipelineBuilderError {
  constructor(message: string, public agentRole: string) {
    super(message, "AGENT_ERROR");
    this.name = "AgentError";
  }
}
