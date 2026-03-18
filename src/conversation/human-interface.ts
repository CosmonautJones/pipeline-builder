import type { ClarificationQuestion } from "../types/agent.js";
import type { PipelineDefinition } from "../types/pipeline.js";

/**
 * Abstraction for human interaction.
 * Implemented by CLI (inquirer prompts) or programmatic callers.
 */
export interface HumanInterface {
  /** Present clarifying questions and get answers */
  askQuestions(questions: ClarificationQuestion[]): Promise<Record<string, string>>;

  /** Present a pipeline for review */
  reviewPipeline(pipeline: PipelineDefinition): Promise<"approve" | "modify" | "reject">;

  /** Get free-form input from the user */
  getInput(prompt: string): Promise<string>;

  /** Present a human-in-the-loop checkpoint */
  approveStep(nodeId: string, prompt: string): Promise<boolean>;

  /** Display a message to the user */
  display(message: string): void;

  /** Display a status update */
  status(phase: string, message: string): void;
}

/**
 * Non-interactive interface that auto-approves everything.
 * Used for programmatic/testing usage.
 */
export class AutoApproveInterface implements HumanInterface {
  private defaults: Record<string, string>;

  constructor(defaults?: Record<string, string>) {
    this.defaults = defaults ?? {};
  }

  async askQuestions(questions: ClarificationQuestion[]): Promise<Record<string, string>> {
    const answers: Record<string, string> = {};
    for (const q of questions) {
      answers[q.id] = this.defaults[q.id] ?? q.defaultAnswer ?? q.options?.[0] ?? "yes";
    }
    return answers;
  }

  async reviewPipeline(): Promise<"approve" | "modify" | "reject"> {
    return "approve";
  }

  async getInput(): Promise<string> {
    return "";
  }

  async approveStep(): Promise<boolean> {
    return true;
  }

  display(message: string): void {
    console.log(message);
  }

  status(phase: string, message: string): void {
    console.log(`[${phase}] ${message}`);
  }
}
