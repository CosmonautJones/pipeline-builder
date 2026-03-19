import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { join, extname, basename, resolve } from "node:path";
import { existsSync } from "node:fs";
import YAML from "yaml";
import type { PipelineDefinition } from "../types/pipeline.js";
import { PipelineDefinitionSchema } from "../schema/pipeline.js";
import { createChildLogger } from "../utils/logger.js";

/**
 * File-system based pipeline storage.
 * Stores pipeline definitions as YAML or JSON files.
 */
export class PipelineStore {
  private logger = createChildLogger("PipelineStore");

  constructor(private directory: string) {}

  /**
   * Initialize the storage directory.
   */
  async init(): Promise<void> {
    if (!existsSync(this.directory)) {
      await mkdir(this.directory, { recursive: true });
    }
  }

  /**
   * Save a pipeline definition to disk.
   */
  async save(
    pipeline: PipelineDefinition,
    format: "yaml" | "json" = "yaml",
  ): Promise<string> {
    await this.init();

    const filename = `${this.sanitizeFilename(pipeline.metadata.name)}.pipeline.${format}`;
    const filepath = join(this.directory, filename);

    const content = format === "yaml"
      ? YAML.stringify(pipeline, { indent: 2 })
      : JSON.stringify(pipeline, null, 2);

    await writeFile(filepath, content, "utf-8");
    this.logger.info(`Saved pipeline to ${filepath}`);
    return filepath;
  }

  /**
   * Load a pipeline definition from disk.
   */
  async load(nameOrPath: string): Promise<PipelineDefinition> {
    let filepath = nameOrPath;

    // If just a name, look for it in the directory
    if (!nameOrPath.includes("/") && !nameOrPath.includes("\\")) {
      const files = await this.listFiles();
      const match = files.find(f =>
        basename(f).startsWith(this.sanitizeFilename(nameOrPath))
      );
      if (!match) throw new Error(`Pipeline not found: ${nameOrPath}`);
      filepath = match;
    }

    // Prevent path traversal — resolve and verify the path is within the store directory
    const resolvedPath = resolve(filepath);
    const resolvedDir = resolve(this.directory);
    if (!resolvedPath.startsWith(resolvedDir + "/") && resolvedPath !== resolvedDir) {
      throw new Error(`Access denied: path "${nameOrPath}" is outside the pipelines directory`);
    }

    const content = await readFile(resolvedPath, "utf-8");
    const ext = extname(filepath).toLowerCase();

    let raw: unknown;
    if (ext === ".yaml" || ext === ".yml") {
      raw = YAML.parse(content);
    } else {
      raw = JSON.parse(content);
    }

    return PipelineDefinitionSchema.parse(raw);
  }

  /**
   * List all saved pipeline files.
   */
  async list(): Promise<Array<{ name: string; path: string; format: string }>> {
    await this.init();
    const files = await this.listFiles();
    return files.map(f => ({
      name: basename(f).replace(/\.pipeline\.(yaml|json)$/, ""),
      path: f,
      format: extname(f).slice(1),
    }));
  }

  /**
   * Delete a saved pipeline.
   */
  async delete(nameOrPath: string): Promise<void> {
    const files = await this.listFiles();
    const match = files.find(f =>
      f === nameOrPath || basename(f).startsWith(this.sanitizeFilename(nameOrPath))
    );
    if (match) {
      await unlink(match);
      this.logger.info(`Deleted pipeline: ${match}`);
    }
  }

  private async listFiles(): Promise<string[]> {
    await this.init();
    const entries = await readdir(this.directory);
    return entries
      .filter(e => e.endsWith(".pipeline.yaml") || e.endsWith(".pipeline.json"))
      .map(e => join(this.directory, e));
  }

  private sanitizeFilename(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }
}
