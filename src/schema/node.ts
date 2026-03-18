import { z } from "zod";

// ── Retry & Error Policies ──────────────────────────────────────────

export const RetryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).default(1),
  backoffMs: z.number().int().min(0).default(1000),
  backoffMultiplier: z.number().min(1).default(2),
  retryableErrors: z.array(z.string()).optional(),
});

export const ErrorPolicySchema = z.enum(["fail", "skip", "fallback"]);

// ── Node I/O Ports ──────────────────────────────────────────────────

export const NodePortSchema = z.object({
  name: z.string(),
  type: z.enum(["string", "number", "boolean", "object", "array", "any"]),
  description: z.string().optional(),
  required: z.boolean().default(true),
});

// ── Node Types ──────────────────────────────────────────────────────

export const NodeTypeSchema = z.enum([
  "action",        // Executes a tool/function
  "condition",     // Branching logic (if/else routing)
  "transform",     // Data transformation between steps
  "human-review",  // Human-in-the-loop checkpoint
  "sub-pipeline",  // Nested pipeline invocation
  "trigger",       // Pipeline entry point (webhook, cron, manual)
  "aggregator",    // Joins parallel branches back together
]);

// ── Human Review Config ─────────────────────────────────────────────

export const HumanReviewConfigSchema = z.object({
  prompt: z.string(),
  approvalRequired: z.boolean().default(true),
  timeoutMs: z.number().int().optional(),
  escalateTo: z.string().optional(),
});

// ── Pipeline Node ───────────────────────────────────────────────────

export const PipelineNodeSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]+$/, "Node IDs must be lowercase alphanumeric with hyphens/underscores"),
  name: z.string().min(1),
  description: z.string().optional(),
  type: NodeTypeSchema,

  // Tool binding (for action nodes)
  tool: z.string().optional(),                       // MCP tool identifier: "server:tool_name"
  toolInput: z.record(z.unknown()).optional(),        // Static or templated inputs {{ var }}

  // I/O contract
  inputs: z.array(NodePortSchema).default([]),
  outputs: z.array(NodePortSchema).default([]),

  // Input mappings: where data comes from
  // Format: { "paramName": "nodes.step_id.outputs.field" | "variables.varName" | "{{ expression }}" }
  inputMappings: z.record(z.string(), z.string()).default({}),

  // Dependencies (alternative to explicit edges)
  dependsOn: z.array(z.string()).default([]),

  // Conditional execution
  condition: z.string().optional(),

  // Human-in-the-loop
  humanReview: HumanReviewConfigSchema.optional(),

  // Sub-pipeline reference
  subPipelineRef: z.string().optional(),

  // Policies
  retry: RetryPolicySchema.optional(),
  errorPolicy: ErrorPolicySchema.default("fail"),
  timeoutMs: z.number().int().optional(),

  // Metadata
  tags: z.array(z.string()).default([]),
  metadata: z.record(z.unknown()).default({}),
});
