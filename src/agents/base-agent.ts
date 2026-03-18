import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import type { AgentRole, AgentContext, AgentResult, Agent, AgentMessage } from "../types/agent.js";
import { generateMessageId } from "../utils/id.js";
import { createChildLogger } from "../utils/logger.js";
import { AgentError } from "../utils/errors.js";

export interface LLMProvider {
  complete(systemPrompt: string, messages: Array<{ role: "user" | "assistant"; content: string }>, options?: { maxTokens?: number; temperature?: number }): Promise<string>;
}

/**
 * Anthropic-backed LLM provider using the Claude API.
 */
export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  private model: string;

  constructor(options?: { apiKey?: string; model?: string }) {
    this.client = new Anthropic({ apiKey: options?.apiKey });
    this.model = options?.model ?? "claude-sonnet-4-20250514";
  }

  async complete(
    systemPrompt: string,
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    options?: { maxTokens?: number; temperature?: number },
  ): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0.3,
      system: systemPrompt,
      messages,
    });

    const textBlock = response.content.find(b => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No text response from LLM");
    }
    return textBlock.text;
  }
}

/**
 * Abstract base class for all pipeline builder agents.
 * Each agent has a role, a system prompt, and a structured output schema.
 */
export abstract class BaseAgent implements Agent {
  abstract readonly role: AgentRole;
  abstract readonly description: string;
  protected abstract readonly systemPrompt: string;
  protected abstract readonly outputSchema: z.ZodType;
  protected logger;

  constructor(protected llm: LLMProvider) {
    this.logger = createChildLogger(this.constructor.name);
  }

  async execute(context: AgentContext): Promise<AgentResult> {
    this.logger.info({ phase: context.phase, iteration: context.iteration }, `${this.role} agent executing`);

    const userPrompt = this.buildUserPrompt(context);
    const messages = [
      ...context.userMessages,
      { role: "user" as const, content: userPrompt },
    ];

    const raw = await this.llm.complete(this.systemPrompt, messages, {
      maxTokens: this.getMaxTokens(),
      temperature: this.getTemperature(),
    });

    const parsed = this.parseResponse(raw);
    return this.toAgentResult(parsed, context);
  }

  protected abstract buildUserPrompt(context: AgentContext): string;
  protected abstract toAgentResult(parsed: unknown, context: AgentContext): AgentResult;

  protected parseResponse(raw: string): unknown {
    // Extract JSON from response (handles markdown code blocks)
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : raw.trim();

    try {
      const data = JSON.parse(jsonStr);
      return this.outputSchema.parse(data);
    } catch (e) {
      throw new AgentError(
        `${this.role} agent failed to parse LLM response: ${e instanceof Error ? e.message : String(e)}`,
        this.role,
      );
    }
  }

  protected createMessage(
    to: AgentMessage["to"],
    type: AgentMessage["type"],
    content: string,
    context: AgentContext,
    payload?: unknown,
  ): AgentMessage {
    return {
      id: generateMessageId(),
      from: this.role,
      to,
      type,
      content,
      payload,
      timestamp: Date.now(),
      conversationId: context.conversationId,
    };
  }

  protected getMaxTokens(): number {
    return 4096;
  }

  protected getTemperature(): number {
    return 0.3;
  }
}
