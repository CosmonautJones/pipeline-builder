import { z } from "zod";

export const PipelineEdgeSchema = z.object({
  from: z.string(),               // Source node ID
  fromPort: z.string().optional(), // Specific output port name
  to: z.string(),                  // Target node ID
  toPort: z.string().optional(),   // Specific input port name
  condition: z.string().optional(),// Guard expression (evaluated at runtime)
  label: z.string().optional(),    // Human-readable edge label
});
