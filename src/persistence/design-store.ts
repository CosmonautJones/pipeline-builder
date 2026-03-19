import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { PipelineDefinition } from "../types/pipeline.js";
import type { ParsedIntent, TaskPlan } from "../types/agent.js";

export interface DesignRecord {
  id: string;
  timestamp: number;
  intent: ParsedIntent;
  plan?: TaskPlan;
  pipeline?: PipelineDefinition;
  domain: string;
  outcome: "success" | "failure" | "rejected";
  failureReason?: string;
  userFeedback?: string[];
  tags: string[];
}

/**
 * Stores pipeline design history for learning.
 * Successful designs become few-shot examples for agents.
 * Failed designs help agents avoid repeating mistakes.
 */
export class DesignStore {
  private records: DesignRecord[] = [];
  private loaded = false;

  constructor(private directory: string) {}

  private get filepath(): string {
    return join(this.directory, "design-history.json");
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (!existsSync(this.directory)) {
      await mkdir(this.directory, { recursive: true });
    }
    if (existsSync(this.filepath)) {
      const content = await readFile(this.filepath, "utf-8");
      this.records = JSON.parse(content);
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await writeFile(this.filepath, JSON.stringify(this.records, null, 2), "utf-8");
  }

  async save(record: DesignRecord): Promise<void> {
    await this.ensureLoaded();
    this.records.push(record);
    await this.persist();
  }

  /**
   * Find successful designs similar to a given intent.
   * Used as few-shot examples for agents.
   */
  async findSimilar(domain: string, limit = 3): Promise<DesignRecord[]> {
    await this.ensureLoaded();
    return this.records
      .filter(r => r.outcome === "success" && r.domain === domain)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Find past failures for a domain to help agents avoid repeating mistakes.
   */
  async findFailures(domain: string, limit = 3): Promise<DesignRecord[]> {
    await this.ensureLoaded();
    return this.records
      .filter(r => r.outcome === "failure" && r.domain === domain)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Get all records.
   */
  async list(): Promise<DesignRecord[]> {
    await this.ensureLoaded();
    return [...this.records];
  }

  /**
   * Get design stats.
   */
  async stats(): Promise<{ total: number; success: number; failure: number; rejected: number; byDomain: Record<string, number> }> {
    await this.ensureLoaded();
    const byDomain: Record<string, number> = {};
    let success = 0, failure = 0, rejected = 0;
    for (const r of this.records) {
      if (r.outcome === "success") success++;
      else if (r.outcome === "failure") failure++;
      else rejected++;
      byDomain[r.domain] = (byDomain[r.domain] ?? 0) + 1;
    }
    return { total: this.records.length, success, failure, rejected, byDomain };
  }
}
