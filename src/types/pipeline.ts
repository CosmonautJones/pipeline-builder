import type { z } from "zod";
import type {
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
} from "../schema/index.js";

export type PipelineDefinition = z.infer<typeof PipelineDefinitionSchema>;
export type PipelineNode = z.infer<typeof PipelineNodeSchema>;
export type PipelineEdge = z.infer<typeof PipelineEdgeSchema>;
export type PipelineMetadata = z.infer<typeof PipelineMetadataSchema>;
export type PipelineVariable = z.infer<typeof PipelineVariableSchema>;
export type NodePort = z.infer<typeof NodePortSchema>;
export type NodeType = z.infer<typeof NodeTypeSchema>;
export type RetryPolicy = z.infer<typeof RetryPolicySchema>;
export type ErrorPolicy = z.infer<typeof ErrorPolicySchema>;
export type HumanReviewConfig = z.infer<typeof HumanReviewConfigSchema>;
export type Trigger = z.infer<typeof TriggerSchema>;
export type McpServerRef = z.infer<typeof McpServerRefSchema>;
export type TimeoutPolicy = z.infer<typeof TimeoutPolicySchema>;
