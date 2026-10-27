import { LlmError } from "../errors";
import { type HttpOptions, postJson, readBody } from "../http";
import { parseSse } from "../sse";
import type { CompletionRequest, LlmProvider } from "../types";

export interface OpenAiCompatibleConfig {
  id: string;
  baseUrl: string;
  /** Omitted for local servers (Ollama, LM Studio) that need no key. */
  apiKey?: string;
  http: HttpOptions;
}

interface ChatChunk {
  choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
  error?: { message?: string };
}

/**
 * Speaks the `/chat/completions` streaming protocol. That one dialect covers OpenAI, Ollama,
 * LM Studio, vLLM, OpenRouter, Groq, Together and Azure's compatibility endpoint.
 */
export class OpenAiCompatibleProvider implements LlmProvider {
  readonly id: string;
  private readonly config: OpenAiCompatibleConfig;

  constructor(config: OpenAiCompatibleConfig) {
    this.config = config;
    this.id = config.id;
  }

  async *stream(request: CompletionRequest): AsyncGenerator<string> {
    const { baseUrl, apiKey, http } = this.config;
    const messages = request.system
      ? [{ role: "system", content: request.system }, ...request.messages]
      : request.messages;

    const response = await postJson(
      `${baseUrl.replace(/\/+$/, "")}/chat/completions`,
      apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      {
        model: request.model,
        messages,
        stream: true,
        max_tokens: request.maxTokens,
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      },
      http,
      request.signal,
    );

    for await (const event of parseSse(
      readBody(response, http.timeoutMs, request.signal),
      request.signal,
    )) {
      if (event.data === "[DONE]") return;
      let chunk: ChatChunk;
      try {
        chunk = JSON.parse(event.data) as ChatChunk;
      } catch (error) {
        throw new LlmError("protocol", "The provider sent a malformed stream event.", {
          cause: error,
        });
      }
      if (chunk.error) {
        throw new LlmError(
          "server",
          `The provider reported an error: ${chunk.error.message ?? "unknown"}`,
        );
      }
      const text = chunk.choices?.[0]?.delta?.content;
      if (text) yield text;
    }
  }
}
