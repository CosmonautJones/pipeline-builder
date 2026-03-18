import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import type { PipelineDefinition } from "../types/pipeline.js";
import { PipelineDefinitionSchema } from "../schema/pipeline.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, "../../templates");

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  tags: string[];
}

const TEMPLATE_MANIFEST: TemplateInfo[] = [
  {
    id: "ci-cd",
    name: "CI/CD Pipeline",
    description: "Continuous integration and deployment with test → build → deploy stages",
    tags: ["ci", "cd", "deployment", "testing"],
  },
  {
    id: "data-processing",
    name: "Data Processing Pipeline",
    description: "Extract-Transform-Load (ETL) pipeline for data processing workflows",
    tags: ["data", "etl", "processing"],
  },
  {
    id: "content-generation",
    name: "Content Generation Pipeline",
    description: "AI-assisted content creation with review and publishing stages",
    tags: ["content", "ai", "generation", "publishing"],
  },
  {
    id: "code-review",
    name: "Code Review Pipeline",
    description: "Automated code review with linting, testing, and human approval",
    tags: ["code", "review", "quality"],
  },
];

/**
 * Registry for built-in pipeline templates.
 */
export class TemplateRegistry {
  /**
   * List all available templates.
   */
  list(): TemplateInfo[] {
    return TEMPLATE_MANIFEST;
  }

  /**
   * Search templates by keyword.
   */
  search(query: string): TemplateInfo[] {
    const lower = query.toLowerCase();
    return TEMPLATE_MANIFEST.filter(t =>
      t.name.toLowerCase().includes(lower) ||
      t.description.toLowerCase().includes(lower) ||
      t.tags.some(tag => tag.includes(lower))
    );
  }

  /**
   * Load a template as a PipelineDefinition.
   */
  async load(templateId: string): Promise<PipelineDefinition> {
    const filepath = join(TEMPLATES_DIR, `${templateId}.pipeline.yaml`);
    const content = await readFile(filepath, "utf-8");
    const raw = YAML.parse(content);
    return PipelineDefinitionSchema.parse(raw);
  }

  /**
   * Get template info by ID.
   */
  get(templateId: string): TemplateInfo | undefined {
    return TEMPLATE_MANIFEST.find(t => t.id === templateId);
  }
}
