import { z } from "zod";
import { PipelineNodeSchema, RetryPolicySchema } from "./node.js";
import { PipelineEdgeSchema } from "./edge.js";

// ── Pipeline Metadata ───────────────────────────────────────────────

export const PipelineMetadataSchema = z.object({
  name: z.string().min(1),
  version: z.string().default("1.0.0"),
  description: z.string().optional(),
  author: z.string().optional(),
  tags: z.array(z.string()).default([]),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

// ── Pipeline Variables ──────────────────────────────────────────────

export const PipelineVariableSchema = z.object({
  name: z.string(),
  type: z.enum(["string", "number", "boolean", "object", "secret"]),
  description: z.string().optional(),
  default: z.unknown().optional(),
  required: z.boolean().default(true),
});

// ── Trigger Configuration ───────────────────────────────────────────

export const TriggerSchema = z.object({
  type: z.enum(["manual", "cron", "webhook", "event", "file-watch"]),
  config: z.record(z.unknown()).default({}),
});

// ── MCP Server Reference ────────────────────────────────────────────

export const McpServerRefSchema = z.object({
  name: z.string(),
  command: z.string().optional(),       // for stdio transport
  args: z.array(z.string()).default([]),
  url: z.string().optional(),           // for HTTP transport
  env: z.record(z.string()).default({}),
  transport: z.enum(["stdio", "streamable-http"]).default("stdio"),
  autoInstall: z.boolean().default(false),
});

// ── Timeout Policy ──────────────────────────────────────────────────

export const TimeoutPolicySchema = z.object({
  stepTimeoutMs: z.number().int().min(0).default(300_000),
  pipelineTimeoutMs: z.number().int().min(0).optional(),
});

// ── Pipeline Definition (top-level) ─────────────────────────────────

export const PipelineDefinitionSchema = z.object({
  apiVersion: z.literal("pipeline-builder/v1"),
  metadata: PipelineMetadataSchema,

  // The graph
  nodes: z.array(PipelineNodeSchema).min(1),
  edges: z.array(PipelineEdgeSchema).default([]),

  // Context
  variables: z.array(PipelineVariableSchema).default([]),
  secrets: z.array(z.string()).default([]),
  env: z.record(z.string()).default({}),

  // Trigger
  trigger: TriggerSchema.default({ type: "manual" }),

  // Global policies
  retryPolicy: RetryPolicySchema.optional(),
  timeoutPolicy: TimeoutPolicySchema.optional(),

  // MCP servers this pipeline depends on
  mcpServers: z.array(McpServerRefSchema).default([]),

  // Metadata
  tags: z.array(z.string()).default([]),
});
