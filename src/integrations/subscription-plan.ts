import { TemplateRegistry } from "../templates/index.js";
import { readFile, writeFile, mkdir, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Path to the versioned reference docs shipped with the package.
 * These live in docs/pipeline-design/ at the repo root and are
 * included in the npm package via the "files" field in package.json.
 */
const SHIPPED_DOCS_DIR = join(__dirname, "../../docs/pipeline-design");

/**
 * Subscription-only plan mode — multi-file architecture.
 *
 * Generates a slim CLAUDE.md entry point + copies versioned reference docs
 * from the package into the user's project. The docs are version-locked
 * to the pipeline-builder release, so they always match the schema.
 *
 * File layout generated:
 *   CLAUDE.md                              (~30 lines — goal + TOC)
 *   .pipeline-builder/docs/methodology.md  (from package)
 *   .pipeline-builder/docs/schema.md       (from package)
 *   .pipeline-builder/docs/node-types.md   (from package)
 *   .pipeline-builder/docs/rules.md        (from package)
 *   .pipeline-builder/docs/template.md     (auto-matched, generated)
 *   .pipeline-builder/docs/VERSION         (package version for cache busting)
 *
 * For Cursor:
 *   .cursor/rules/pb-task.mdc              (alwaysApply — just the goal)
 *   .cursor/rules/pb-schema.mdc            (globs: *.pipeline.yaml)
 *   .cursor/rules/pb-nodes.mdc             (globs: *.pipeline.yaml)
 *   .cursor/rules/pb-rules.mdc             (globs: *.pipeline.yaml)
 */

export interface SubscriptionPlanOptions {
  goal: string;
  templateHint?: string;
  outputDir?: string;
  target?: "claude-code" | "cursor" | "both";
}

// ── Helpers ─────────────────────────────────────────────────────────

async function readShippedDoc(filename: string): Promise<string> {
  return readFile(join(SHIPPED_DOCS_DIR, filename), "utf-8");
}

async function getPackageVersion(): Promise<string> {
  try {
    const pkg = JSON.parse(await readFile(join(__dirname, "../../package.json"), "utf-8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

// ── Generator ───────────────────────────────────────────────────────

export async function generateSubscriptionPlan(
  options: SubscriptionPlanOptions,
): Promise<{ files: string[]; instructions: string }> {
  const files: string[] = [];
  const outputDir = options.outputDir ?? ".";
  const target = options.target ?? "both";
  const docsDir = join(outputDir, ".pipeline-builder", "docs");
  const pipelinesDir = join(outputDir, ".pipelines");

  // Ensure directories
  for (const dir of [docsDir, pipelinesDir]) {
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  }

  // ── Copy versioned docs from package ──────────────────────────

  const docFiles = ["methodology.md", "schema.md", "node-types.md", "rules.md"];
  for (const doc of docFiles) {
    const src = join(SHIPPED_DOCS_DIR, doc);
    const dest = join(docsDir, doc);
    if (existsSync(src)) {
      await cp(src, dest);
      files.push(dest);
    }
  }

  // Write version file for cache busting
  const version = await getPackageVersion();
  await writeFile(join(docsDir, "VERSION"), `pipeline-builder@${version}\n`, "utf-8");

  // ── Load + write matched template ─────────────────────────────

  const registry = new TemplateRegistry();
  let templateContent = "";
  let templateName = "";

  if (options.templateHint) {
    try {
      const t = await registry.load(options.templateHint);
      templateContent = YAML.stringify(t, { indent: 2 });
      templateName = options.templateHint;
    } catch { /* not found */ }
  }

  if (!templateContent) {
    const templates = registry.list();
    const goalLower = options.goal.toLowerCase();
    const match = templates.find(t =>
      t.tags.some(tag => goalLower.includes(tag)) || goalLower.includes(t.id)
    );
    if (match) {
      try {
        const t = await registry.load(match.id);
        templateContent = YAML.stringify(t, { indent: 2 });
        templateName = match.name;
      } catch { /* ignore */ }
    }
  }

  if (templateContent) {
    const templateDoc = `# Template: ${templateName}\n\nUse as a starting point. Modify to match the goal.\n\n\`\`\`yaml\n${templateContent}\`\`\`\n`;
    await writeFile(join(docsDir, "template.md"), templateDoc, "utf-8");
    files.push(join(docsDir, "template.md"));
  }

  // ── Generate CLAUDE.md (slim entry point) ─────────────────────

  if (target === "claude-code" || target === "both") {
    const claudeMd = `# Pipeline Builder — Design Task

## Goal

> **${options.goal}**

## What to do

Design a pipeline YAML and save it to \`.pipelines/<name>.pipeline.yaml\`.

## Reference docs (v${version})

Read these as needed (in \`.pipeline-builder/docs/\`):

| Doc | When to read |
|-----|-------------|
| [methodology.md](.pipeline-builder/docs/methodology.md) | Start here — the 5-step design process |
| [schema.md](.pipeline-builder/docs/schema.md) | When writing the YAML — field reference |
| [node-types.md](.pipeline-builder/docs/node-types.md) | When choosing node types — examples |
| [rules.md](.pipeline-builder/docs/rules.md) | Before finalizing — validation checklist |
${templateContent ? `| [template.md](.pipeline-builder/docs/template.md) | Closest built-in template to start from |` : ""}

## Quick start

1. Read \`.pipeline-builder/docs/methodology.md\`
2. Follow the 5 steps (clarify → decompose → design → write → validate)
3. Save to \`.pipelines/\`
4. Run: \`pb validate .pipelines/<name>.pipeline.yaml\`
`;

    const claudePath = join(outputDir, "CLAUDE.md");
    await writeFile(claudePath, claudeMd, "utf-8");
    files.push(claudePath);
  }

  // ── Generate Cursor rules (multiple focused files) ────────────

  if (target === "cursor" || target === "both") {
    const rulesDir = join(outputDir, ".cursor", "rules");
    if (!existsSync(rulesDir)) await mkdir(rulesDir, { recursive: true });

    // Task rule (always active, slim)
    await writeFile(join(rulesDir, "pb-task.mdc"), `---
description: "Pipeline design task — the current goal"
alwaysApply: true
---

# Pipeline Design Task

**Goal:** ${options.goal}

Save the pipeline to \`.pipelines/<name>.pipeline.yaml\`.
Follow the methodology in \`.pipeline-builder/docs/methodology.md\`.
Validate with: \`pb validate .pipelines/<name>.pipeline.yaml\`
`, "utf-8");

    // Schema rule (activates on pipeline files)
    const schemaDoc = await readShippedDoc("schema.md");
    await writeFile(join(rulesDir, "pb-schema.mdc"), `---
description: "Pipeline YAML schema reference (v${version})"
globs: "**/*.pipeline.yaml,**/*.pipeline.json"
---

${schemaDoc}
`, "utf-8");

    // Node types rule
    const nodesDoc = await readShippedDoc("node-types.md");
    await writeFile(join(rulesDir, "pb-nodes.mdc"), `---
description: "Pipeline node type reference and examples (v${version})"
globs: "**/*.pipeline.yaml"
---

${nodesDoc}
`, "utf-8");

    // Rules rule
    const rulesDoc = await readShippedDoc("rules.md");
    await writeFile(join(rulesDir, "pb-rules.mdc"), `---
description: "Pipeline validation rules (v${version})"
globs: "**/*.pipeline.yaml"
---

${rulesDoc}
`, "utf-8");

    files.push(
      join(rulesDir, "pb-task.mdc"),
      join(rulesDir, "pb-schema.mdc"),
      join(rulesDir, "pb-nodes.mdc"),
      join(rulesDir, "pb-rules.mdc"),
    );
  }

  const instructions = target === "cursor"
    ? `Open Cursor and say: "Design the pipeline described in the rules"`
    : `Open Claude Code and say: "Design the pipeline"`;

  return { files, instructions };
}
