import type { LLMProvider } from "../base-agent.js";

/**
 * OpenAI-compatible provider — works with any API that follows
 * the OpenAI chat completions format.
 *
 * Compatible with: OpenAI, Azure OpenAI, Together AI, Groq,
 * OpenRouter, Fireworks AI, vLLM, LocalAI, LM Studio, etc.
 *
 * No SDK dependency — uses native fetch.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  private baseUrl: string;
  private model: string;
  private apiKey: string;

  constructor(options: {
    baseUrl?: string;
    model?: string;
    apiKey?: string;
  }) {
    this.baseUrl = options.baseUrl ?? "https://api.openai.com/v1";
    this.model = options.model ?? "gpt-4o";
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? "";
  }

  async complete(
    systemPrompt: string,
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    options?: { maxTokens?: number; temperature?: number },
  ): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        max_tokens: options?.maxTokens ?? 4096,
        temperature: options?.temperature ?? 0.3,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI-compatible API error: ${response.status} ${body}`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content ?? "";
  }
}
