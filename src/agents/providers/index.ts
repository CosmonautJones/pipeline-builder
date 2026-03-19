import type { LLMProvider } from "../base-agent.js";
import { AnthropicProvider } from "../base-agent.js";
import { OllamaProvider } from "./ollama-provider.js";
import { OpenAICompatibleProvider } from "./openai-compatible-provider.js";

export { OllamaProvider } from "./ollama-provider.js";
export { OpenAICompatibleProvider } from "./openai-compatible-provider.js";

export interface ProviderConfig {
  provider: "anthropic" | "ollama" | "openai" | "openai-compatible";
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Factory function — creates the right LLM provider from config.
 */
export function createLLMProvider(config: ProviderConfig): LLMProvider {
  switch (config.provider) {
    case "anthropic":
      return new AnthropicProvider({
        apiKey: config.apiKey,
        model: config.model,
      });

    case "ollama":
      return new OllamaProvider({
        baseUrl: config.baseUrl,
        model: config.model,
      });

    case "openai":
    case "openai-compatible":
      return new OpenAICompatibleProvider({
        baseUrl: config.baseUrl,
        model: config.model,
        apiKey: config.apiKey,
      });

    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}
